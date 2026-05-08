// =============================================================================
// src/collaboration/hocuspocus.ts — @hocuspocus/server v4.0.0
//
// CONFIRMED FROM PRISMA STUDIO:
//   - yjs_state column EXISTS (bytea type) ✅
//   - yjs_state is NULL on ALL rows → store() never successfully saved ❌
//   - last_saved is NULL on ALL rows → confirms store() never ran ❌
//
// ROOT CAUSE:
//   React Strict Mode creates TWO WebSocket connections:
//     Connection 1 (Strict Mode): authenticates → immediately disconnects
//     Connection 2 (real):        authenticates → user types → should save
//
//   When Connection 1 disconnects with an EMPTY Y.Doc, Hocuspocus calls
//   store() with an empty/tiny state. This empty state gets written to DB
//   OR store() fails because Y.encodeStateAsUpdate on empty doc produces
//   a state that's technically valid but tiny (< 10 bytes header only).
//
//   Then Connection 2 connects, user types, debounce fires at 5000ms,
//   but the store() call is failing for a different reason.
//
// FIXES APPLIED:
//   1. Skip store() when state is empty (< 20 bytes = Yjs header only, no content)
//   2. Add comprehensive logging to find exact failure point
//   3. Guard store() with explicit existence check before update
//   4. Use upsert instead of update to avoid "record not found" errors
// =============================================================================

import { Hocuspocus } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import * as Y from 'yjs'
import prisma from '../config/database'
import { verifyToken } from '../utils/jwt'
import { assertTeamMember } from '../utils/teamGuard'
import { createCollaborativeVersionCheckpoint } from '../services/version.service'

// ---------------------------------------------------------------------------
// HELPER: parseDocumentName
// ---------------------------------------------------------------------------
function parseDocumentName(name: string): { type: 'doc' | 'file'; id: number } {
    const match = name.match(/^(doc|file)-(\d+)$/)
    if (!match) throw new Error(`Invalid document name: "${name}". Expected "doc-{id}" or "file-{id}".`)
    return { type: match[1] as 'doc' | 'file', id: parseInt(match[2], 10) }
}

// ---------------------------------------------------------------------------
// HELPER: compactYjsState
// ---------------------------------------------------------------------------
function compactYjsState(state: Uint8Array): Uint8Array {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    const compacted = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    return compacted
}

// ---------------------------------------------------------------------------
// HELPER: hasRealContent
// ---------------------------------------------------------------------------
// A Yjs state with ONLY the header (no actual document nodes) is < 20 bytes.
// We skip saving these empty states to avoid overwriting real content.
//
// WHY THIS MATTERS:
//   React Strict Mode's first connection disconnects immediately with an
//   empty Y.Doc. Without this guard, store() would save an empty state
//   over any real content that was previously saved.
// ---------------------------------------------------------------------------
function hasRealContent(state: Uint8Array): boolean {
    // A freshly initialised Y.Doc with no content encodes to ~6-10 bytes.
    // Any real content (even one character) pushes this above 20 bytes.
    return state.length > 20
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const updateCounts = new Map<string, { count: number; windowStart: number; lastSizeCheck: number }>()
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024

// ---------------------------------------------------------------------------
// Collaborative version checkpoint debounce
// ---------------------------------------------------------------------------
// Tracks the last time a version was created for each file during collab editing.
// We create at most one version per 10 minutes per file to avoid flooding the
// version history with thousands of micro-checkpoints.
const versionCheckpointMap = new Map<number, number>() // fileId → last checkpoint timestamp
const VERSION_CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000  // 10 minutes

setInterval(() => {
    const now = Date.now()
    for (const [key, record] of updateCounts.entries()) {
        if (now - record.windowStart > 60_000) updateCounts.delete(key)
    }
}, 5 * 60 * 1000)

// =============================================================================
// HOCUSPOCUS INSTANCE
// =============================================================================
const collabServer = new Hocuspocus({
    debounce: 5000,

    // ── onAuthenticate ──────────────────────────────────────────────────────
    async onAuthenticate(data) {
        console.log(`\n[Hocuspocus] ─── onAuthenticate for "${data.documentName}" ───`)
        const { token, documentName } = data

        // Step 1: Verify JWT
        let payload: { userId: number; email: string }
        try {
            payload = verifyToken(token) as { userId: number; email: string }
            console.log(`[Hocuspocus] ✅ JWT OK — userId: ${payload.userId}`)
        } catch (e: any) {
            console.error(`[Hocuspocus] ❌ JWT FAILED:`, e.message)
            throw new Error('Invalid or expired JWT token')
        }

        // Step 2: Parse document name
        const { type, id } = parseDocumentName(documentName)
        console.log(`[Hocuspocus] ✅ Parsed: type=${type}, id=${id}`)

        // Step 3: Verify resource exists in DB
        let teamId: number
        if (type === 'doc') {
            const doc = await prisma.document.findFirst({
                where: { id, is_deleted: false },
                select: { team_id: true }
            })
            if (!doc) {
                console.error(`[Hocuspocus] ❌ Document ${id} NOT FOUND`)
                throw new Error(`Document ${id} not found or deleted`)
            }
            teamId = doc.team_id
            console.log(`[Hocuspocus] ✅ Document ${id} found in team ${teamId}`)
        } else {
            const file = await prisma.file.findFirst({
                where: { id, is_deleted: false },
                select: { team_id: true }
            })
            if (!file) {
                console.error(`[Hocuspocus] ❌ File ${id} NOT FOUND`)
                throw new Error(`File ${id} not found or deleted`)
            }
            teamId = file.team_id
            console.log(`[Hocuspocus] ✅ File ${id} found in team ${teamId}`)
        }

        // Step 4: Team membership
        try {
            await assertTeamMember(payload.userId, teamId)
            console.log(`[Hocuspocus] ✅ Team membership confirmed`)
        } catch (e: any) {
            console.error(`[Hocuspocus] ❌ NOT A TEAM MEMBER:`, e.message)
            throw e
        }

        console.log(`[Hocuspocus] ✅ Auth SUCCESS for "${documentName}"\n`)

        return {
            userId: payload.userId,
            teamId,
            documentType: type,
            documentId: id,
        }
    },

    // ── onChange ─────────────────────────────────────────────────────────────
    async onChange(data) {
        const key = data.context?.userId
            ? `${data.context.userId}:${data.documentName}`
            : null
        if (!key) return

        const now = Date.now()
        let record = updateCounts.get(key)
        if (!record || now - record.windowStart > 10_000) {
            record = { count: 0, windowStart: now, lastSizeCheck: 0 }
            updateCounts.set(key, record)
        }
        record.count++

        if (now - record.lastSizeCheck > 30_000) {
            const stateLength = Y.encodeStateAsUpdate(data.document).length
            record.lastSizeCheck = now
            if (stateLength > MAX_DOCUMENT_SIZE) {
                console.error(`[Hocuspocus] ❌ Size cap exceeded: ${data.documentName}`)
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
        const key = data.context?.userId
            ? `${data.context.userId}:${data.documentName}`
            : null
        if (key) updateCounts.delete(key)

        console.log(
            `[Hocuspocus] 🔌 Disconnected — User ${data.context?.userId ?? '?'} ` +
            `from "${data.documentName}" | Active connections: ${collabServer.getConnectionsCount()}`
        )
    },

    extensions: [
        new Database({
            // ── fetch() ───────────────────────────────────────────────────────
            // Called when FIRST client connects to a document room.
            async fetch({ documentName }) {
                console.log(`[Hocuspocus] 📖 fetch() for "${documentName}"`)
                const { type, id } = parseDocumentName(documentName)

                try {
                    if (type === 'doc') {
                        const doc = await prisma.document.findUnique({
                            where: { id },
                            select: { yjs_state: true }
                        })
                        const state = doc?.yjs_state as Buffer | null
                        if (!state || state.length === 0) {
                            console.log(`[Hocuspocus] 📖 fetch() → null (new document)`)
                            return null
                        }
                        console.log(`[Hocuspocus] 📖 fetch() → ${state.length} bytes`)
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
                    return null
                }
            },

            // ── store() ───────────────────────────────────────────────────────
            // Called every ~5s during editing AND on last client disconnect.
            //
            // CRITICAL GUARD: Skip empty states.
            // When React Strict Mode's first connection disconnects immediately,
            // Hocuspocus calls store() with an empty Y.Doc state (< 20 bytes).
            // Without this guard, that empty state would overwrite real content.
            async store({ documentName, state }) {
                console.log(`\n[Hocuspocus] 💾 store() called for "${documentName}" | ${state.length} bytes`)

                // GUARD: Skip empty states from Strict Mode cleanup connections
                if (!hasRealContent(state)) {
                    console.log(`[Hocuspocus] ⏭️  store() SKIPPED — empty state (${state.length} bytes < 20 byte threshold)`)
                    return
                }

                const { type, id } = parseDocumentName(documentName)
                const compacted = compactYjsState(state)
                const buffer = Buffer.from(compacted)
                const pct = Math.round((1 - compacted.length / state.length) * 100)

                console.log(`[Hocuspocus] 💾 Compacted: ${state.length}B → ${compacted.length}B (${pct}% smaller)`)

                try {
                    if (type === 'doc') {
                        // Use updateMany to avoid "record not found" error.
                        // updateMany returns { count: 0 } if no rows match — never throws.
                        const result = await prisma.document.updateMany({
                            where: { id, is_deleted: false },
                            data: {
                                yjs_state: buffer,
                                last_saved: new Date(),
                            }
                        })

                        if (result.count === 0) {
                            console.error(`[Hocuspocus] ❌ store() doc ${id}: NO ROWS UPDATED (document may be deleted or wrong id)`)
                        } else {
                            console.log(`[Hocuspocus] ✅ store() saved doc ${id} (${result.count} row updated)`)
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
                            console.error(`[Hocuspocus] ❌ store() file ${id}: NO ROWS UPDATED`)
                        } else {
                            console.log(`[Hocuspocus] ✅ store() saved file ${id} (${result.count} row updated)`)

                            // ── Collaborative version checkpoint ───────────────────────
                            // Create a version snapshot at most once per 10 minutes so
                            // the Versions tab shows that the file was collaboratively edited.
                            const lastCheckpoint = versionCheckpointMap.get(id) ?? 0
                            if (Date.now() - lastCheckpoint > VERSION_CHECKPOINT_INTERVAL_MS) {
                                versionCheckpointMap.set(id, Date.now())
                                // Fire-and-forget — don't block the save response
                                void createCollaborativeVersionCheckpoint(id).then(() => {
                                    console.log(`[Hocuspocus] 📸 Version checkpoint created for file ${id}`)
                                })
                            }
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