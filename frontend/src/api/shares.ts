import api from './axios'
import publicApi from './publicAxios'
import type { CloudFile, Folder } from '../types'

export interface ShareLinkPayload {
    password?: string
    expiresInHours?: number
    downloadLimit?: number
}

export interface SharedLink {
    id: number
    token: string
    created_by: number
    expiration_date: string | null
    download_limit: number | null
    downloads_count: number
    created_at: string
    // Populated relations for team-wide sharing view
    files?: { id: number; original_name: string; mime_type: string } | null
    folders?: { id: number; name: string } | null
    documents?: { id: number; title: string } | null
    creator?: { id: number; username: string; full_name: string | null } | null
}

export interface ShareMetadata {
    type: 'file' | 'folder' | 'team' | 'document'
    requiresPassword: boolean
    filename?: string
    fileSize?: number
    mimeType?: string
    folderName?: string
    teamName?: string
    title?: string
}

export interface SharedContent {
    files: CloudFile[]
    folders: Folder[]
    documents?: Array<{ id: number; title: string; created_at: string; updated_at: string }>
}

// ─── AUTHENTICATED ACTIONS ────────────────────────────────────────────────

// Create a share link for a specific file
export async function createFileShareLink(fileId: number, teamId: number, options: ShareLinkPayload): Promise<SharedLink> {
    const response = await api.post<{ link: SharedLink }>(`/files/${fileId}/share`, {
        teamId,
        ...options
    })
    return response.data.link
}

// Create a share link for a specific folder
export async function createFolderShareLink(folderId: number, teamId: number, options: ShareLinkPayload): Promise<SharedLink> {
    const response = await api.post<{ link: SharedLink }>(`/folders/${folderId}/share`, {
        teamId,
        ...options
    })
    return response.data.link
}

// Fetch all active share links for a file
export async function fetchFileShares(fileId: number, teamId: number): Promise<SharedLink[]> {
    const response = await api.get<{ links: SharedLink[] }>(`/files/${fileId}/share`, {
        params: { teamId }
    })
    return response.data.links
}

// Create a share link for a specific document
export async function createDocumentShareLink(documentId: number, teamId: number, options: ShareLinkPayload): Promise<SharedLink> {
    const response = await api.post<{ link: SharedLink }>(`/teams/${teamId}/documents/${documentId}/share`, {
        teamId,
        ...options
    })
    return response.data.link
}

// Fetch all active share links for a document
export async function fetchDocumentShares(documentId: number, teamId: number): Promise<SharedLink[]> {
    const response = await api.get<{ links: SharedLink[] }>(`/teams/${teamId}/documents/${documentId}/shares`, {
        params: { teamId }
    })
    return response.data.links
}

// Fetch all active share links for the entire team
export async function fetchTeamShareLinks(teamId: number): Promise<SharedLink[]> {
    const response = await api.get<SharedLink[]>(`/teams/${teamId}/share-links`)
    return response.data
}

// Revoke a share link
export async function revokeShareLink(token: string): Promise<void> {
    await api.delete(`/share/${token}`)
}

// ─── PUBLIC ACTIONS ───────────────────────────────────────────────────────
// These use publicApi so they do not send JWT tokens or redirect to login.

// Get basic metadata before downloading (to show "Enter Password" UI if needed)
export async function getSharedLinkMetadata(token: string): Promise<ShareMetadata> {
    const response = await publicApi.get<ShareMetadata>(`/share/${token}`)
    return response.data
}

// Get team contents if the link points to an entire team
export async function getSharedTeamContent(token: string, password?: string, folderId?: number | null): Promise<SharedContent> {
    const response = await publicApi.get<SharedContent>(`/share/${token}/content`, {
        headers: password ? { 'x-share-password': password } : {},
        params: { folderId }
    })
    return response.data
}

// Download a specific file. Returns a Blob.
export async function downloadSharedFile(token: string, password?: string, fileId?: number): Promise<{ blob: Blob; filename: string }> {
    const response = await publicApi.post(
        `/share/${token}/download`,
        { fileId },
        {
            headers: password ? { 'x-share-password': password } : {},
            responseType: 'blob'
        }
    )

    // Extract filename from the content-disposition header if present
    const disposition = response.headers['content-disposition']
    let fileOriginalName = 'download'
    if (disposition && disposition.indexOf('attachment') !== -1) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition)
        if (matches != null && matches[1]) {
            fileOriginalName = matches[1].replace(/['"]/g, '')
        }
    }

    return { blob: response.data as Blob, filename: fileOriginalName }
}

// Get the HTML content of a shared document
export async function getSharedDocumentContent(token: string, password?: string, documentId?: number): Promise<{ html: string; title: string }> {
    const response = await publicApi.get<{ html: string; title: string }>(`/share/${token}/document`, {
        headers: password ? { 'x-share-password': password } : {},
        params: { documentId }
    })
    return response.data
}

