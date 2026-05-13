// =============================================================================
// src/controllers/document.controller.ts
//
// PURPOSE: Thin HTTP layer for document CRUD operations.
//          Each controller function does exactly 3 things:
//            1. Read params/body from req
//            2. assertTeamMember (all endpoints are team-scoped — Problem 2 & 3 fix)
//            3. Call the service → send response
//
// ROUTE SCOPING RATIONALE (Problem 2 & 3 fix from review):
//   All document routes use /api/teams/:teamId/documents/:docId.
//   This means:
//     a) The teamId is always validated against the user's JWT
//     b) A user cannot rename/delete documents in teams they don't belong to
//     c) Pattern is consistent with every other endpoint in this app
// =============================================================================

import { Request, Response } from 'express'
import * as DocumentService from '../services/document.service'
import { assertTeamMember, AppError } from '../utils/teamGuard'
import prisma from '../config/database'
import { extractHtmlFromYjsState } from '../services/file.service'

// ---------------------------------------------------------------------------
// Helper: parse and validate integer params
// ---------------------------------------------------------------------------
function parseId(val: unknown): number {
    const n = parseInt(String(val), 10)
    if (isNaN(n)) throw new AppError('Invalid ID — must be a number', 400)
    return n
}

// ---------------------------------------------------------------------------
// CONTROLLER: createDocument
// ROUTE:   POST /api/teams/:teamId/documents
// BODY:    { title?: string, folderId?: number }
// OUTPUT:  201 { id, title, ... }
// ---------------------------------------------------------------------------
// WHY EDITOR ROLE (not viewer):
//   Viewers can read documents but should not be able to create new ones.
//   Creating a document claims storage and collaboration resources.
// ---------------------------------------------------------------------------
export async function createDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const userId = req.user!.userId
    const { title, folderId } = req.body

    try {
        await assertTeamMember(userId, teamId, 'editor')
        const doc = await DocumentService.createDocument({
            teamId,
            createdBy: userId,
            title: title?.trim() || 'Untitled Document',
            folderId: folderId ? parseInt(String(folderId), 10) : undefined,
        })
        res.status(201).json(doc)
    } catch (err: any) {
        if (err.message === 'FOLDER_NOT_FOUND') {
            res.status(404).json({ error: 'Folder not found or does not belong to this team' })
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: listDocuments
// ROUTE:   GET /api/teams/:teamId/documents
// OUTPUT:  200 DocumentSummary[]
// ---------------------------------------------------------------------------
export async function listDocuments(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const userId = req.user!.userId

    try {
        // Viewers can list documents — they just can't edit or create
        await assertTeamMember(userId, teamId, 'viewer')

        let folderId: number | null | undefined;
        if (req.query.folderId === undefined) {
            folderId = undefined;
        } else if (req.query.folderId === 'null') {
            folderId = null;
        } else {
            const parsed = parseInt(req.query.folderId as string, 10);
            folderId = isNaN(parsed) ? undefined : parsed;
        }

        const docs = await DocumentService.listDocuments(teamId, folderId)
        res.json(docs)
    } catch (err: any) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: getDocument
// ROUTE:   GET /api/teams/:teamId/documents/:docId
// OUTPUT:  200 DocumentSummary | 404
// ---------------------------------------------------------------------------
// WHY WE NEED THIS ENDPOINT:
//   DocumentEditor fetches this on mount (for 'document' mode) to:
//     1. Display the title in the header before the editor loads
//     2. Detect invalid docIds early — show error instead of blank editor
//        (Problem 6 fix from review: show proper error state if 404)
// ---------------------------------------------------------------------------
export async function getDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId

    try {
        await assertTeamMember(userId, teamId, 'viewer')
        const doc = await DocumentService.getDocument(docId, teamId)
        if (!doc) {
            res.status(404).json({ error: 'Document not found or has been deleted' })
            return
        }
        res.json(doc)
    } catch (err: any) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: renameDocument
// ROUTE:   PATCH /api/teams/:teamId/documents/:docId
// BODY:    { title: string }
// OUTPUT:  200 { id, title }
// ---------------------------------------------------------------------------
// WHY EDITOR ROLE (not viewer):
//   Renaming a document is a write operation. Viewers should only read.
// ---------------------------------------------------------------------------
export async function renameDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId
    const { title } = req.body

    if (!title || typeof title !== 'string') {
        res.status(400).json({ error: '"title" is required and must be a string' })
        return
    }

    try {
        await assertTeamMember(userId, teamId, 'editor')
        const updated = await DocumentService.renameDocument(docId, teamId, title)
        res.json(updated)
    } catch (err: any) {
        if (err.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (err.message === 'TITLE_EMPTY') {
            res.status(400).json({ error: 'Title cannot be empty' })
            return
        }
        if (err.message === 'TITLE_TOO_LONG') {
            res.status(400).json({ error: 'Title must be 255 characters or fewer' })
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: deleteDocument
// ROUTE:   DELETE /api/teams/:teamId/documents/:docId
// OUTPUT:  200 { success: true }
// ---------------------------------------------------------------------------
// WHY SOFT DELETE (not hard):
//   See document.service.ts for the full rationale.
//   TL;DR: keeps Hocuspocus from reconnecting (onAuthenticate checks is_deleted),
//   while allowing potential recovery later without DB-level restore.
// ---------------------------------------------------------------------------
export async function deleteDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId

    try {
        // WHY 'editor' not 'admin': Any editor can delete their own documents.
        // If you want only admins to delete, change this to 'admin'.
        await assertTeamMember(userId, teamId, 'editor')
        await DocumentService.softDeleteDocument(docId, teamId)
        res.json({ success: true })
    } catch (err: any) {
        if (err.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: moveDocument
// ROUTE:   PATCH /api/teams/:teamId/documents/:docId/move
// BODY:    { folderId: number | null }
// OUTPUT:  200 { id, folder_id }
// ---------------------------------------------------------------------------
export async function moveDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId
    const { folderId } = req.body

    try {
        await assertTeamMember(userId, teamId, 'editor')
        const updated = await DocumentService.moveDocument(docId, teamId, folderId === null ? null : parseInt(String(folderId), 10))
        res.json(updated)
    } catch (err: any) {
        if (err.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (err.message === 'FOLDER_NOT_FOUND') {
            res.status(404).json({ error: 'Target folder not found' })
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: previewDocument
// ROUTE:   GET /api/teams/:teamId/documents/:docId/preview
// OUTPUT:  200 { html: string }
// ---------------------------------------------------------------------------
// PURPOSE: Returns rendered HTML from the document's Yjs CRDT state.
//          Used by DocumentDetailSidebar to show a live content preview
//          without opening the full collaborative editor.
//
// WHY READ yjs_state DIRECTLY:
//   The Hocuspocus server stores all document content as a Yjs CRDT binary.
//   There is no separate "rendered" field. We decode it server-side using
//   our extractHtmlFromYjsState helper (same logic used for file previews).
// ---------------------------------------------------------------------------
export async function previewDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId

    try {
        await assertTeamMember(userId, teamId, 'viewer')

        const doc = await prisma.documents.findFirst({
            where: { id: docId, team_id: teamId, is_deleted: false },
            select: { yjs_state: true }
        })

        if (!doc) {
            res.status(404).json({ error: 'Document not found' })
            return
        }

        const yjsState = doc.yjs_state as Buffer | null
        if (!yjsState || yjsState.length < 20) {
            res.status(200).json({
                html: '<p><em>This document is empty. Open it to start writing.</em></p>'
            })
            return
        }

        const html = extractHtmlFromYjsState(yjsState)
        res.status(200).json({ html })
    } catch (err: any) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: lockDocument
// ROUTE:   POST /api/teams/:teamId/documents/:docId/lock
// OUTPUT:  200 { id, lockOwnerUserId, lockExpiresAt }
// ---------------------------------------------------------------------------
export async function lockDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId

    try {
        await assertTeamMember(userId, teamId, 'editor')
        const updated = await DocumentService.lockDocument(docId, teamId, userId)
        res.json(updated)
    } catch (err: any) {
        if (err.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (err.message === 'DOCUMENT_LOCKED') {
            res.status(409).json({ error: 'Document is already locked by another user' })
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: unlockDocument
// ROUTE:   POST /api/teams/:teamId/documents/:docId/unlock
// OUTPUT:  200 { id }
// ---------------------------------------------------------------------------
export async function unlockDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId

    try {
        await assertTeamMember(userId, teamId, 'editor')
        const updated = await DocumentService.unlockDocument(docId, teamId, userId)
        res.json(updated)
    } catch (err: any) {
        if (err.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (err.message === 'DOCUMENT_LOCKED_BY_OTHER') {
            res.status(403).json({ error: 'Cannot unlock document locked by another user' })
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}

// ---------------------------------------------------------------------------
// CONTROLLER: forceUnlockDocument (admin only)
// ROUTE:   POST /api/teams/:teamId/documents/:docId/force-unlock
// ---------------------------------------------------------------------------
export async function forceUnlockDocument(req: Request, res: Response): Promise<void> {
    const teamId = parseId(req.params.teamId)
    const docId = parseId(req.params.docId)
    const userId = req.user!.userId

    try {
        await assertTeamMember(userId, teamId, 'admin')
        const updated = await DocumentService.forceUnlockDocument(docId, teamId)
        res.json({ success: true, ...updated })
    } catch (err: any) {
        if (err.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        throw err
    }
}
