// =============================================================================
// src/services/document.service.ts
//
// PURPOSE: Business logic for CloudTeams native documents.
//          Native documents are different from uploaded files:
//            - They are created blank (no file upload)
//            - Their content lives entirely in the Yjs CRDT (yjs_state column)
//            - Hocuspocus auto-saves via its Database extension every 5 seconds
//            - They have editable titles (unlike files which get names from upload)
//
// WHY NO MANUAL SAVE:
//   Hocuspocus's store() hook fires every 5 seconds during editing and on the
//   last client disconnect. There is no need for a "Save" button — the content
//   is always at most 5 seconds stale in the DB.
//
// WHY SOFT DELETE (not hard delete):
//   Soft delete (is_deleted = true) keeps the DB row. This means:
//     1. Hocuspocus onAuthenticate blocks reconnection (it checks is_deleted:false)
//     2. The yjs_state can be recovered by an admin if needed
//     3. Consistent with how files work in this codebase
//   We do NOT add deleted documents to the RecycleBin UI this sprint.
// =============================================================================

import prisma from '../config/database'


// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface CreateDocumentInput {
    teamId: number
    createdBy: number
    title?: string        // defaults to "Untitled Document"
    folderId?: number     // optional — place in a folder
}

export interface DocumentSummary {
    id: number
    title: string
    folderId: number | null
    createdBy: number
    creatorName: string | null
    lastSaved: Date | null
    createdAt: Date
    updatedAt: Date
    deletedAt?: Date | null
    lockOwnerUserId?: number | null
    lockExpiresAt?: Date | null
}

// ---------------------------------------------------------------------------
// createDocument
// ---------------------------------------------------------------------------
// PURPOSE: Insert a new blank document DB row so Hocuspocus can fetch it.
//
// WHY WE CREATE THE ROW BEFORE CONNECTING:
//   Hocuspocus.onAuthenticate checks prisma.documents.findFirst({ is_deleted: false }).
//   If the row doesn't exist, the WebSocket is rejected before the editor loads.
//   We must create the row FIRST, then navigate the user to the editor URL.
//
// WHY yjs_state IS null ON CREATION:
//   Hocuspocus.fetch() returns null → Hocuspocus creates a fresh empty Y.Doc.
//   On first keystroke the store() hook fires, writing the real binary state.
//   This is the intended flow — no need to seed with a fake Yjs state.
// ---------------------------------------------------------------------------
export async function createDocument(input: CreateDocumentInput) {
    const { teamId, createdBy, title = 'Untitled Document', folderId } = input

    // Validate folder belongs to this team if provided
    if (folderId) {
        const folder = await prisma.folder.findFirst({
            where: { id: folderId, team_id: teamId }
        })
        if (!folder) {
            throw new Error('FOLDER_NOT_FOUND')
        }
    }

    const doc = await prisma.documents.create({
        data: {
            team_id: teamId,
            created_by: createdBy,
            title,
            folder_id: folderId ?? null,
            yjs_state: null,       // blank — Hocuspocus initialises fresh Y.Doc
            is_deleted: false,
            updated_at: new Date(),
        },
        select: {
            id: true,
            title: true,
            folder_id: true,
            created_by: true,
            last_saved: true,
            created_at: true,
            updated_at: true,
        }
    })

    return doc
}

// ---------------------------------------------------------------------------
// listDocuments
// ---------------------------------------------------------------------------
// PURPOSE: Return all non-deleted documents for a team, sorted newest first.
//
// WHY INCLUDE creator SELECT:
//   The documents list UI shows "Created by Alice" under each card.
//   Joining the User table in Prisma is just a nested select — no extra query.
// ---------------------------------------------------------------------------
export async function listDocuments(teamId: number, folderId?: number | null): Promise<DocumentSummary[]> {
    const docs = await prisma.documents.findMany({
        where: {
            team_id: teamId,
            is_deleted: false,
            ...(folderId !== undefined && { folder_id: folderId }),
        },
        select: {
            id: true,
            title: true,
            folder_id: true,
            created_by: true,
            last_saved: true,
            created_at: true,
            updated_at: true,
            lockOwnerUserId: true,
            lockExpiresAt: true,
            users: {
                select: { full_name: true, username: true }
            }
        },
        orderBy: { updated_at: 'desc' }
    })

    return docs.map(d => ({
        id: d.id,
        title: d.title,
        folderId: d.folder_id,
        createdBy: d.created_by,
        creatorName: d.users.full_name ?? d.users.username ?? null,
        lastSaved: d.last_saved,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        lockOwnerUserId: d.lockOwnerUserId,
        lockExpiresAt: d.lockExpiresAt,
    }))
}

// ---------------------------------------------------------------------------
// getDocument
// ---------------------------------------------------------------------------
// PURPOSE: Fetch a single document — used by DocumentEditor to display the
//          title in the header and to detect if the docId is valid.
// ---------------------------------------------------------------------------
export async function getDocument(docId: number, teamId: number): Promise<DocumentSummary | null> {
    const doc = await prisma.documents.findFirst({
        where: {
            id: docId,
            team_id: teamId,
            is_deleted: false,
        },
        select: {
            id: true,
            title: true,
            folder_id: true,
            created_by: true,
            last_saved: true,
            created_at: true,
            updated_at: true,
            lockOwnerUserId: true,
            lockExpiresAt: true,
            users: {
                select: { full_name: true, username: true }
            }
        }
    })

    if (!doc) return null

    return {
        id: doc.id,
        title: doc.title,
        folderId: doc.folder_id,
        createdBy: doc.created_by,
        creatorName: doc.users.full_name ?? doc.users.username ?? null,
        lastSaved: doc.last_saved,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        lockOwnerUserId: doc.lockOwnerUserId,
        lockExpiresAt: doc.lockExpiresAt,
    }
}

// ---------------------------------------------------------------------------
// renameDocument
// ---------------------------------------------------------------------------
// PURPOSE: Update the document title.
//
// WHY TRIM + LENGTH CHECK HERE (not just in controller):
//   Defence-in-depth. The controller validates the HTTP body, but the service
//   also enforces it so the constraint holds if the service is ever called
//   from another code path (e.g., a future import/migration script).
// ---------------------------------------------------------------------------
export async function renameDocument(
    docId: number,
    teamId: number,
    newTitle: string
) {
    const trimmed = newTitle.trim()
    if (!trimmed) throw new Error('TITLE_EMPTY')
    if (trimmed.length > 255) throw new Error('TITLE_TOO_LONG')

    // Verify document exists in this team before updating
    const existing = await prisma.documents.findFirst({
        where: { id: docId, team_id: teamId, is_deleted: false },
        select: { id: true }
    })
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND')

    const updated = await prisma.documents.update({
        where: { id: docId },
        data: { title: trimmed },
        select: { id: true, title: true }
    })

    return updated
}

// ---------------------------------------------------------------------------
// softDeleteDocument
// ---------------------------------------------------------------------------
// PURPOSE: Mark a document as deleted without removing it from the DB.
//
// EFFECT ON HOCUSPOCUS:
//   onAuthenticate checks is_deleted: false. Any client still connected
//   with this documentName will lose their next reconnect attempt.
//   Currently connected clients stay connected until they refresh.
//   (Full real-time kick-out would require a WebSocket message — out of scope.)
// ---------------------------------------------------------------------------
export async function softDeleteDocument(docId: number, teamId: number) {
    const existing = await prisma.documents.findFirst({
        where: { id: docId, team_id: teamId, is_deleted: false },
        select: { id: true }
    })
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND')

    // Update is_deleted to true instead of hard deleting (to protect audit trail logic)
    await prisma.documents.update({
        where: { id: docId },
        data: {
            is_deleted: true,
            deleted_at: new Date(),
        }
    })

}

// ---------------------------------------------------------------------------
// moveDocument
// ---------------------------------------------------------------------------
export async function moveDocument(docId: number, teamId: number, targetFolderId: number | null) {
    const existing = await prisma.documents.findFirst({
        where: { id: docId, team_id: teamId, is_deleted: false },
        select: { id: true }
    })
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND')

    if (targetFolderId !== null) {
        const folder = await prisma.folder.findFirst({
            where: { id: targetFolderId, team_id: teamId }
        })
        if (!folder) throw new Error('FOLDER_NOT_FOUND')
    }

    const updated = await prisma.documents.update({
        where: { id: docId },
        data: { folder_id: targetFolderId },
        select: { id: true, folder_id: true }
    })

    return updated
}

// ---------------------------------------------------------------------------
// lockDocument
// ---------------------------------------------------------------------------
export async function lockDocument(docId: number, teamId: number, userId: number, durationMinutes: number = 60) {
    const existing = await prisma.documents.findFirst({
        where: { id: docId, team_id: teamId, is_deleted: false },
        select: { id: true, lockOwnerUserId: true, lockExpiresAt: true }
    })
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND')

    if (existing.lockExpiresAt && existing.lockExpiresAt > new Date() && existing.lockOwnerUserId !== userId) {
        throw new Error('DOCUMENT_LOCKED')
    }

    const expiresAt = new Date(Date.now() + durationMinutes * 60000)

    const updated = await prisma.documents.update({
        where: { id: docId },
        data: {
            lockOwnerUserId: userId,
            lockExpiresAt: expiresAt,
            lockToken: Math.random().toString(36).substring(2, 15)
        },
        select: { id: true, lockOwnerUserId: true, lockExpiresAt: true }
    })

    return updated
}

// ---------------------------------------------------------------------------
// unlockDocument
// ---------------------------------------------------------------------------
export async function unlockDocument(docId: number, teamId: number, userId: number, force: boolean = false) {
    const existing = await prisma.documents.findFirst({
        where: { id: docId, team_id: teamId, is_deleted: false },
        select: { id: true, lockOwnerUserId: true }
    })
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND')

    if (!force && existing.lockOwnerUserId !== userId) {
        throw new Error('DOCUMENT_LOCKED_BY_OTHER')
    }

    const updated = await prisma.documents.update({
        where: { id: docId },
        data: {
            lockOwnerUserId: null,
            lockExpiresAt: null,
            lockToken: null
        },
        select: { id: true }
    })

    return updated
}

// ---------------------------------------------------------------------------
// forceUnlockDocument (admin only — called by the controller after role check)
// ---------------------------------------------------------------------------
export async function forceUnlockDocument(docId: number, teamId: number) {
    const existing = await prisma.documents.findFirst({
        where: { id: docId, team_id: teamId, is_deleted: false },
        select: { id: true }
    })
    if (!existing) throw new Error('DOCUMENT_NOT_FOUND')

    const updated = await prisma.documents.update({
        where: { id: docId },
        data: {
            lockOwnerUserId: null,
            lockExpiresAt: null,
            lockToken: null
        },
        select: { id: true }
    })

    return updated
}
