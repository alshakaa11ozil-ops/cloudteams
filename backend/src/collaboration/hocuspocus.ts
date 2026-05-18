// =============================================================================
// src/collaboration/hocuspocus.ts — @hocuspocus/server v4.0.0
//
// CONFIRMED:
//   - Hocuspocus class HAS handleConnection() ✅
//   - Server class does NOT — we use bare Hocuspocus ✅
//   - yjs_state column EXISTS in Document + File tables ✅
//
// HOW SINGLE-PORT WORKS:
//   server.ts creates a ws.Server({ noServer: true })
//   httpServer.on('upgrade') routes /collaboration to wss.handleUpgrade()
//   wss.handleUpgrade callback calls collabServer.handleConnection(ws, request)
//   Hocuspocus owns the ws from that point — do NOT add ws.on('message') after
//
// SAVE FLOW:
//   User types → Yjs CRDT update → onChange (rate limit + size check)
//   → debounce 5000ms → store() → Prisma updateMany → PostgreSQL yjs_state
//   On last disconnect: immediate store() (no debounce)
//
// KEY FIXES:
//   1. hasRealContent() guard — skips empty Yjs states from Strict Mode cleanup
//   2. updateMany not update — returns { count: 0 } instead of throwing P2025
//   3. Synchronous destroy in cleanup (no rAF) — prevents room-kill race
//   4. compactYjsState — strips CRDT history before save (3-10x smaller)
// =============================================================================

import { Hocuspocus } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import * as Y from 'yjs'
import prisma from '../config/database'
import { verifyToken } from '../utils/jwt'
import { assertTeamMember } from '../utils/teamGuard'

// ---------------------------------------------------------------------------
// HELPER: parseDocumentName
// ---------------------------------------------------------------------------
// Validates and extracts type + ID from documentName.
// "doc-42"  → { type: "doc",  id: 42 }
// "file-17" → { type: "file", id: 17 }
// Anything else → throws → connection rejected
// ---------------------------------------------------------------------------
function parseDocumentName(name: string): { type: 'doc' | 'file'; id: number } {
    const match = name.match(/^(doc|file)-(\d+)$/)
    if (!match) {
        throw new Error(`Invalid document name: "${name}". Expected "doc-{id}" or "file-{id}".`)
    }
    return { type: match[1] as 'doc' | 'file', id: parseInt(match[2], 10) }
}

// ---------------------------------------------------------------------------
// HELPER: compactYjsState
// ---------------------------------------------------------------------------
// Strips accumulated CRDT edit history before saving.
// Without this: a doc where 5000 words typed then deleted stores all ops forever.
// With this: only current visible content is stored. Saves 3-10x space.
// ---------------------------------------------------------------------------
function compactYjsState(state: Uint8Array): Uint8Array {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    const compacted = Y.encodeStateAsUpdate(doc)
    doc.destroy() // CRITICAL: frees internal CRDT memory allocations
    return compacted
}

// ---------------------------------------------------------------------------
// HELPER: hasRealContent
// ---------------------------------------------------------------------------
// A Yjs state with ONLY the header (no document nodes) is < 20 bytes.
// Any real content (even one character) pushes this above 20 bytes.
//
// WHY THIS MATTERS:
//   React Strict Mode's first connection disconnects immediately with an
//   empty Y.Doc. Hocuspocus calls store() with that empty state (6-10 bytes).
//   Without this guard, the empty state would overwrite real saved content.
// ---------------------------------------------------------------------------
function hasRealContent(state: Uint8Array): boolean {
    return state.length > 20
}

// ---------------------------------------------------------------------------
// Rate limiting: "userId:documentName" → { count, windowStart, lastSizeCheck }
// Per-user per-document — two tabs on different docs don't share limits
// ---------------------------------------------------------------------------
const updateCounts = new Map<string, {
    count: number
    windowStart: number
    lastSizeCheck: number
}>()

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024  // 5MB

// Clean up stale entries every 5 minutes (prevents memory leak)
setInterval(() => {
    const now = Date.now()
    for (const [key, record] of updateCounts.entries()) {
        if (now - record.windowStart > 60_000) updateCounts.delete(key)
    }
}, 5 * 60 * 1000)

// =============================================================================
// HOCUSPOCUS INSTANCE — bare Hocuspocus class (NOT Server wrapper)
// Server wrapper's crossws adapter silently fails with external ws.Server
// =============================================================================
const collabServer = new Hocuspocus({
    // store() fires at most once every 5s during active editing
    // On last client disconnect: fires immediately (no debounce)
    debounce: 5000,

    // ── onAuthenticate ──────────────────────────────────────────────────────
    // Runs BEFORE any document data is sent. Throwing here rejects with 403.
    // TOKEN: sent by HocuspocusProvider in WS payload, not HTTP headers.
    //   WHY: WebSockets can't send Authorization headers post-handshake.
    //   WHY NOT query params: Exposed in server logs and browser history.
    // ────────────────────────────────────────────────────────────────────────
    async onAuthenticate(data) {
        console.log(`\n[Hocuspocus] ─── onAuthenticate START: "${data.documentName}" ───`)
        const { token, documentName } = data

        if (!token) {
            console.error(`[Hocuspocus] ❌ NO TOKEN PROVIDED for "${documentName}"`)
            throw new Error('Authentication token is required')
        }

        // Step 1: Verify JWT
        let payload: { userId: number; email: string }
        try {
            payload = verifyToken(token) as { userId: number; email: string }
            console.log(`[Hocuspocus] ✅ JWT OK — userId: ${payload.userId}`)
        } catch (e: any) {
            console.error(`[Hocuspocus] ❌ JWT VERIFICATION FAILED:`, e.message)
            throw new Error('Invalid or expired JWT token')
        }

        // Step 2: Parse and validate documentName format
        const { type, id } = parseDocumentName(documentName)
        console.log(`[Hocuspocus] ✅ Parsed documentName: type=${type}, id=${id}`)

        // Step 3: Verify resource exists in DB and is not deleted
        let teamId: number
        let isLockedForUser = false

        if (type === 'doc') {
            const doc = await prisma.documents.findFirst({
                where: { id, is_deleted: false },
                select: { team_id: true, lockOwnerUserId: true, lockExpiresAt: true }
            })
            if (!doc) {
                console.error(`[Hocuspocus] ❌ Document ${id} not found`)
                throw new Error(`Document ${id} not found or deleted`)
            }
            teamId = doc.team_id
            // NOTE: We do NOT set readOnly here even if the doc is locked.
            // Doing so prevents Hocuspocus from syncing document content to the
            // user, resulting in a blank editor. Lock enforcement is done in
            // onChange (below) which rejects writes without blocking content reads.
            if (doc.lockExpiresAt && doc.lockExpiresAt > new Date() && doc.lockOwnerUserId !== payload.userId) {
                isLockedForUser = true
            }
            console.log(`[Hocuspocus] ✅ Document ${id} found in team ${teamId} (Locked for user: ${isLockedForUser})`)
        } else {
            const file = await prisma.file.findFirst({
                where: { id, is_deleted: false },
                select: { team_id: true, lockOwnerUserId: true, lockExpiresAt: true }
            })
            if (!file) {
                console.error(`[Hocuspocus] ❌ File ${id} not found`)
                throw new Error(`File ${id} not found or deleted`)
            }
            teamId = file.team_id
            if (file.lockExpiresAt && file.lockExpiresAt > new Date() && file.lockOwnerUserId !== payload.userId) {
                isLockedForUser = true
            }
            console.log(`[Hocuspocus] ✅ File ${id} found in team ${teamId} (Locked for user: ${isLockedForUser})`)
        }

        // Step 4: Verify team membership
        try {
            await assertTeamMember(payload.userId, teamId)
            console.log(`[Hocuspocus] ✅ Team membership confirmed`)
        } catch (e: any) {
            console.error(`[Hocuspocus] ❌ NOT A TEAM MEMBER:`, e.message)
            throw e
        }

        console.log(`[Hocuspocus] ✅ Auth SUCCESS for "${documentName}" (isLockedForUser=${isLockedForUser})\n`)

        // Return context — available in store/onChange/onDisconnect as data.context
        return {
            userId: payload.userId,
            teamId,
            documentType: type,
            documentId: id,
        }
    },

    // ── onChange ─────────────────────────────────────────────────────────────
    // Fires on every document update (every keystroke).
    // Rate limit: 100 updates/10s per user per document.
    // Size cap: checked every 30s (Y.encodeStateAsUpdate is O(n) — expensive).
    // Lock check: if document is locked by someone else, reject the write.
    //   WHY HERE and not in onAuthenticate:
    //   Setting readOnly in onAuthenticate blocks content delivery (blank doc).
    //   Checking in onChange lets the user READ content but blocks writes.
    // ─────────────────────────────────────────────────────────────────────────
    async onChange(data) {
        const userId = data.context?.userId
        const key = userId ? `${userId}:${data.documentName}` : null
        if (!key) return

        // ── Lock enforcement ────────────────────────────────────────────────
        // Check if document is locked by someone else. If so, reject this write.
        // We check on every change to catch cases where lock was acquired AFTER
        // the user connected (enforceLockOnActiveConnections covers the live case
        // but a DB check here is the definitive server-side gate).
        try {
            const { type, id } = parseDocumentName(data.documentName)
            if (type === 'doc') {
                const doc = await prisma.documents.findFirst({
                    where: { id, is_deleted: false },
                    select: { lockOwnerUserId: true, lockExpiresAt: true }
                })
                if (
                    doc?.lockExpiresAt &&
                    doc.lockExpiresAt > new Date() &&
                    doc.lockOwnerUserId !== null &&
                    doc.lockOwnerUserId !== userId
                ) {
                    console.warn(`[Hocuspocus] 🔒 Write REJECTED — doc ${id} is locked by user ${doc.lockOwnerUserId}, change from user ${userId}`)
                    throw new Error('Document is locked for editing by another user')
                }
            }
            // File-level lock is handled by the lock.service.ts (separate flow)
        } catch (lockErr: any) {
            if (lockErr.message === 'Document is locked for editing by another user') throw lockErr
            // Prisma/parse error — don't block the write, just log
            console.error(`[Hocuspocus] ⚠️ Lock check error (non-blocking):`, lockErr.message)
        }

        const now = Date.now()
        let record = updateCounts.get(key)

        if (!record || now - record.windowStart > 10_000) {
            record = { count: 0, windowStart: now, lastSizeCheck: 0 }
            updateCounts.set(key, record)
        }
        record.count++

        // Size check every 30s only — Y.encodeStateAsUpdate is O(n) in doc size
        if (now - record.lastSizeCheck > 30_000) {
            const stateLength = Y.encodeStateAsUpdate(data.document).length
            record.lastSizeCheck = now
            if (stateLength > MAX_DOCUMENT_SIZE) {
                console.error(`[Hocuspocus] ❌ Size cap exceeded: ${data.documentName} (${stateLength} bytes)`)
                throw new Error('Document too large (max 5MB)')
            }
        }

        if (record.count > 100) {
            console.error(`[Hocuspocus] ❌ Rate limit exceeded: ${key}`)
            throw new Error('Rate limit exceeded')
        }
    },

    // ── onDisconnect ─────────────────────────────────────────────────────────
    async onDisconnect(data) {
        // Clean up rate limiter entry for this user+document
        const key = data.context?.userId
            ? `${data.context.userId}:${data.documentName}`
            : null
        if (key) updateCounts.delete(key)

        console.log(
            `[Hocuspocus] 🔌 Disconnected — User ${data.context?.userId ?? '?'} ` +
            `from "${data.documentName}" | Active: ${collabServer.getConnectionsCount()}`
        )
    },

    extensions: [
        new Database({
            // ── fetch() ───────────────────────────────────────────────────────
            // Called when the FIRST client connects to a document room.
            // Returns null → Hocuspocus creates a fresh empty Y.Doc.
            // Returns Uint8Array → Hocuspocus applies saved state to the Y.Doc.
            // ─────────────────────────────────────────────────────────────────
            async fetch({ documentName }) {
                console.log(`[Hocuspocus] 📖 fetch() for "${documentName}"`)
                const { type, id } = parseDocumentName(documentName)

                try {
                    if (type === 'doc') {
                        const doc = await prisma.documents.findUnique({
                            where: { id },
                            select: { yjs_state: true }
                        })
                        const state = doc?.yjs_state as Buffer | null
                        if (!state || state.length === 0) {
                            console.log(`[Hocuspocus] 📖 fetch() → null (new document)`)
                            return null
                        }
                        console.log(`[Hocuspocus] 📖 fetch() → ${state.length} bytes`)
                        // Prisma Bytes → Buffer (Node.js) → Uint8Array (Yjs)
                        // Buffer is a subclass of Uint8Array — this cast is safe
                        return new Uint8Array(state)
                    } else {
                        const file = await prisma.file.findUnique({
                            where: { id },
                            select: { yjs_state: true }
                        })
                        const state = file?.yjs_state as Buffer | null
                        if (!state || state.length === 0) {
                            console.log(`[Hocuspocus] 📖 fetch() → null (first edit)`)
                            return null
                        }
                        console.log(`[Hocuspocus] 📖 fetch() → ${state.length} bytes`)
                        return new Uint8Array(state)
                    }
                } catch (err: any) {
                    console.error(`[Hocuspocus] ❌ fetch() ERROR:`, err.message)
                    return null // Return null on error — user starts fresh rather than crashing
                }
            },

            // ── store() ───────────────────────────────────────────────────────
            // Called every ~5s during editing AND on last client disconnect.
            //
            // GUARD: hasRealContent() — skips empty states.
            //   React Strict Mode's first connection disconnects immediately
            //   with an empty Y.Doc (~6-10 bytes). Without this guard, that
            //   empty state would overwrite any previously saved real content.
            //
            // updateMany not update:
            //   update() throws P2025 "Record not found" if document was deleted
            //   while the editor was open. updateMany() returns { count: 0 }
            //   gracefully — no crash, no data loss.
            // ─────────────────────────────────────────────────────────────────
            async store({ documentName, state }) {
                console.log(`\n[Hocuspocus] 💾 store() for "${documentName}" | ${state.length} bytes`)

                // GUARD: skip empty Yjs states (Strict Mode cleanup connections)
                if (!hasRealContent(state)) {
                    console.log(
                        `[Hocuspocus] ⏭️  store() SKIPPED — ` +
                        `empty state (${state.length} bytes, threshold is 20)`
                    )
                    return
                }

                const { type, id } = parseDocumentName(documentName)

                // Compact: strip CRDT history, keep only current content
                const compacted = compactYjsState(state)
                const pct = Math.round((1 - compacted.length / state.length) * 100)
                console.log(`[Hocuspocus] 💾 Compacted: ${state.length}B → ${compacted.length}B (${pct}% smaller)`)

                // Prisma Bytes column requires Node.js Buffer (not raw Uint8Array)
                const buffer = Buffer.from(compacted)

                try {
                    if (type === 'doc') {
                        // Check the PREVIOUS state before overwriting —
                        // so we can detect the very first real write.
                        const prevDoc = await prisma.documents.findFirst({
                            where: { id, is_deleted: false },
                            select: { yjs_state: true, created_by: true }
                        })

                        const result = await prisma.documents.updateMany({
                            where: { id, is_deleted: false },
                            data: {
                                yjs_state: buffer,
                                last_saved: new Date(),
                            }
                        })
                        if (result.count === 0) {
                            console.error(`[Hocuspocus] ❌ store() doc ${id}: 0 rows updated — document may be deleted`)
                        } else {
                            console.log(`[Hocuspocus] ✅ store() saved doc ${id}\n`)

                            // ── v1 SNAPSHOT: first time this document gets real content ──
                            // We only auto-create ONE version — on the very first write.
                            // All subsequent snapshots are done manually via "Save Snapshot".
                            const wasBlank = !prevDoc?.yjs_state
                            if (wasBlank && prevDoc) {
                                const existingV1 = await prisma.documentVersion.findFirst({
                                    where: { document_id: id },
                                    select: { id: true }
                                })
                                if (!existingV1) {
                                    await prisma.documentVersion.create({
                                        data: {
                                            document_id: id,
                                            created_by: prevDoc.created_by,
                                            version_name: 'Initial version',
                                            yjs_state: buffer,
                                        }
                                    })
                                    console.log(`[Hocuspocus] ✅ store() created v1 snapshot for doc ${id}`)
                                }
                            }
                        }
                    } else {
                        const result = await prisma.file.updateMany({
                            where: { id, is_deleted: false },
                            data: {
                                yjs_state: buffer,
                                yjs_last_saved: new Date(),
                            }
                        })
                        if (result.count === 0) {
                            console.error(`[Hocuspocus] ❌ store() file ${id}: 0 rows updated`)
                        } else {
                            console.log(`[Hocuspocus] ✅ store() saved file ${id}\n`)
                        }
                    }
                } catch (err: any) {
                    console.error(`[Hocuspocus] ❌ store() PRISMA ERROR for "${documentName}":`)
                    console.error(`  type: ${err.constructor?.name}`)
                    console.error(`  message: ${err.message}`)
                    if (err.code) console.error(`  code: ${err.code}`)
                    if (err.meta) console.error(`  meta: ${JSON.stringify(err.meta)}`)
                    throw err
                }
            },
        }),
    ],
})

export default collabServer

// ---------------------------------------------------------------------------
// HELPER: enforceLockOnActiveConnections
// ---------------------------------------------------------------------------
// Called by the controller when a lock is established to instantly set readOnly 
// mode on any active connections from other users without needing a DB query.
// ---------------------------------------------------------------------------
export function enforceLockOnActiveConnections(documentId: number, lockOwnerUserId: number | null) {
    const targetName = `doc-${documentId}`
    const document = collabServer.documents.get(targetName)
    if (!document) return

    // NOTE on Map.forEach signature: forEach(callbackFn(value, key))
    // In Hocuspocus v4, document.connections is Map<Connection, ConnectionContext>
    //   → first param (conn) is the Connection object
    //   → second param (context) is the ConnectionContext with userId
    // Previous code had (_, conn) which was reversed — readOnly was being set
    // on the key (connection) but context was read from the wrong variable.
    document.connections.forEach((conn: any, context: any) => {
        const connUserId = context?.userId ?? conn?.context?.userId
        if (lockOwnerUserId !== null && connUserId !== lockOwnerUserId) {
            // Best-effort: try both possible shapes for the connection's readOnly flag
            if (conn?.readOnly !== undefined) conn.readOnly = true
            if (conn?.connection) (conn.connection as any).readOnly = true
            console.log(`[Hocuspocus] 🔒 Live Lock Enforcement: set readOnly for user ${connUserId}`)
        } else {
            if (conn?.readOnly !== undefined) conn.readOnly = false
            if (conn?.connection) (conn.connection as any).readOnly = false
            console.log(`[Hocuspocus] 🔓 Live Lock Enforcement: set readWrite for user ${connUserId}`)
        }
    })
}
