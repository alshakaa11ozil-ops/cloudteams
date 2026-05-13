// =============================================================================
// src/api/documents.ts
//
// PURPOSE: All API calls related to native CloudTeams documents.
//          Uses the shared `api` axios instance so auth tokens are
//          automatically attached and 401 handling is centralised.
//
// PATTERN: Thin wrappers around api.METHOD() that:
//   1. Accept typed input
//   2. Return typed data (no raw AxiosResponse leaks into components)
//   3. Let errors propagate — React Query handles them
// =============================================================================

import api from './axios'

// ---------------------------------------------------------------------------
// TYPES — mirror the backend DocumentSummary shape
// ---------------------------------------------------------------------------

import type { DocumentSummary } from '../types'
export type { DocumentSummary }

// ---------------------------------------------------------------------------
// createDocument
// ---------------------------------------------------------------------------
// POST /api/teams/:teamId/documents
// Called when user clicks "New Document" — creates the DB row FIRST,
// then the caller navigates to /teams/:id/documents/:docId.
//
// WHY CREATE ROW FIRST (Problem 1 fix):
//   Hocuspocus.onAuthenticate() checks prisma.document.findFirst({ is_deleted: false }).
//   If the row doesn't exist, the WebSocket is rejected. We must create the
//   DB row BEFORE the user's browser tries to open the editor.
// ---------------------------------------------------------------------------
export async function createDocument(
    teamId: string,
    data: { title?: string; folderId?: number }
): Promise<DocumentSummary> {
    const res = await api.post(`/teams/${teamId}/documents`, data)
    return res.data
}

// ---------------------------------------------------------------------------
// fetchDocuments
// ---------------------------------------------------------------------------
// GET /api/teams/:teamId/documents
// ---------------------------------------------------------------------------
export async function fetchDocuments(teamId: string, folderId?: string | null): Promise<DocumentSummary[]> {
    const params = new URLSearchParams()
    if (folderId !== undefined) {
        params.append('folderId', folderId === null ? 'null' : folderId)
    }
    const res = await api.get(`/teams/${teamId}/documents?${params.toString()}`)
    return res.data
}

// ---------------------------------------------------------------------------
// fetchDocument
// ---------------------------------------------------------------------------
// GET /api/teams/:teamId/documents/:docId
// Used by DocumentEditor on mount to:
//   1. Get the document title for the header
//   2. Detect invalid docId early → show error instead of blank editor (Problem 6 fix)
// ---------------------------------------------------------------------------
export async function fetchDocument(
    teamId: string,
    docId: string
): Promise<DocumentSummary> {
    const res = await api.get(`/teams/${teamId}/documents/${docId}`)
    return res.data
}

// ---------------------------------------------------------------------------
// renameDocument
// ---------------------------------------------------------------------------
// PATCH /api/teams/:teamId/documents/:docId
// Called on blur of the in-editor title input (Addition 1).
// ---------------------------------------------------------------------------
export async function renameDocument(
    teamId: string,
    docId: string,
    title: string
): Promise<{ id: number; title: string }> {
    const res = await api.patch(`/teams/${teamId}/documents/${docId}`, { title })
    return res.data
}

// ---------------------------------------------------------------------------
// deleteDocument
// ---------------------------------------------------------------------------
// DELETE /api/teams/:teamId/documents/:docId
// Soft-deletes the document (is_deleted = true).
// ---------------------------------------------------------------------------
export async function deleteDocument(
    teamId: string,
    docId: string
): Promise<void> {
    await api.delete(`/teams/${teamId}/documents/${docId}`)
}

// ---------------------------------------------------------------------------
// moveDocument
// ---------------------------------------------------------------------------
// PATCH /api/teams/:teamId/documents/:docId/move
// ---------------------------------------------------------------------------
export async function moveDocument(
    teamId: string | number,
    docId: number,
    folderId: number | null
): Promise<any> {
    const res = await api.patch(`/teams/${teamId}/documents/${docId}/move`, { folderId })
    return res.data
}

// ---------------------------------------------------------------------------
// Document Comments
// ---------------------------------------------------------------------------

export async function fetchDocumentComments(teamId: number, documentId: number): Promise<any[]> {
    const res = await api.get(`/teams/${teamId}/documents/${documentId}/comments`)
    return res.data.comments
}

export async function addDocumentComment(teamId: number, documentId: number, content: string): Promise<any> {
    const res = await api.post(`/teams/${teamId}/documents/${documentId}/comments`, { content })
    return res.data.comment
}

export async function editDocumentComment(teamId: number, commentId: number, content: string): Promise<any> {
    const res = await api.patch(`/teams/${teamId}/comments/${commentId}`, { content })
    return res.data.comment
}

export async function deleteDocumentComment(teamId: number, commentId: number): Promise<void> {
    await api.delete(`/teams/${teamId}/comments/${commentId}`)
}

// ---------------------------------------------------------------------------
// Document Recycle Bin
// ---------------------------------------------------------------------------

export async function restoreDocument(teamId: number, docId: number): Promise<void> {
    await api.post(`/teams/${teamId}/recycle-bin/documents/${docId}/restore`)
}

export async function hardDeleteDocument(teamId: number, docId: number): Promise<void> {
    await api.delete(`/teams/${teamId}/recycle-bin/documents/${docId}`)
}

// ---------------------------------------------------------------------------
// previewDocument
// ---------------------------------------------------------------------------
// GET /api/teams/:teamId/documents/:docId/preview
// Returns rendered HTML extracted from the document's Yjs CRDT state.
// Used by DocumentDetailSidebar to show content without opening the editor.
// ---------------------------------------------------------------------------
export async function previewDocument(
    teamId: number,
    docId: number
): Promise<{ html: string }> {
    const res = await api.get(`/teams/${teamId}/documents/${docId}/preview`)
    return res.data
}

// ---------------------------------------------------------------------------
// Document Versions
// ---------------------------------------------------------------------------

export interface DocumentVersion {
    id: number
    documentId: number
    versionName: string | null
    createdBy: number
    creatorName: string | null
    createdAt: string
}

export async function fetchDocumentVersions(teamId: string | number, docId: string | number): Promise<DocumentVersion[]> {
    const res = await api.get(`/teams/${teamId}/documents/${docId}/versions`)
    return res.data.versions || []
}

export async function createDocumentVersion(teamId: string | number, docId: string | number, versionName?: string): Promise<DocumentVersion> {
    const res = await api.post(`/teams/${teamId}/documents/${docId}/versions`, { versionName })
    return res.data
}

export async function restoreDocumentVersion(teamId: string | number, docId: string | number, versionId: number): Promise<{ success: boolean; message: string }> {
    const res = await api.post(`/teams/${teamId}/documents/${docId}/versions/${versionId}/restore`)
    return res.data
}

// ---------------------------------------------------------------------------
// Document Locking
// ---------------------------------------------------------------------------

export async function lockDocument(
    teamId: string,
    docId: string
): Promise<{ id: number; lockOwnerUserId: number; lockExpiresAt: string }> {
    const res = await api.post(`/teams/${teamId}/documents/${docId}/lock`)
    return res.data
}

export async function unlockDocument(
    teamId: string,
    docId: string
): Promise<{ id: number }> {
    const res = await api.post(`/teams/${teamId}/documents/${docId}/unlock`)
    return res.data
}

export async function forceUnlockDocument(
    teamId: string,
    docId: string
): Promise<{ success: boolean; id: number }> {
    const res = await api.post(`/teams/${teamId}/documents/${docId}/force-unlock`)
    return res.data
}

// ---------------------------------------------------------------------------
// Document Share Link Management
// ---------------------------------------------------------------------------

export async function deleteDocumentShareLink(
    teamId: string,
    docId: string,
    token: string
): Promise<void> {
    await api.delete(`/teams/${teamId}/documents/${docId}/shares/${token}`)
}
