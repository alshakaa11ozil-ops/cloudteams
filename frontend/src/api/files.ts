// src/api/files.ts
//
// PURPOSE: Single source of truth for every API call related to files,
//          folders, and file locking. All functions go through the shared
//          Axios instance (which attaches JWT automatically).
//
// WHY THIS APPROACH:
//   Centralising API calls here means:
//   - Components never touch URLs or response shapes directly
//   - If the backend changes a route, we fix it in ONE place
//   - Every function is independently testable
//
// CONFIRMED AGAINST BACKEND CONTROLLERS (April 2026):
//   file.controller.ts    — upload, list, download, delete
//   folderController.ts   — create, list, delete folders
//   lock.controller.ts    — acquire, heartbeat, release, status
//   share.controller.ts   — create shared link
//
// RESPONSE SHAPE REFERENCE:
//   GET  /api/teams/:id/files?folderId=X → { files: CloudFile[] }
//   POST /api/files/upload               → { message, isDuplicate, file }
//   GET  /api/files/:id/download         → binary blob (NOT JSON)
//   DELETE /api/files/:id               → { message }
//   GET  /api/teams/:id/folders          → { folders: FolderWithBreadcrumb[] }
//   POST /api/folders                    → { folder }
//   DELETE /api/folders/:id             → { message, deletedFiles?, orphanedFiles? }
//   POST /api/teams/:teamId/files/:fileId/lock    → { message, lockToken, lockExpiresAt }
//   POST /api/teams/:teamId/files/:fileId/heartbeat → { message, lockToken, lockExpiresAt }
//   POST /api/teams/:teamId/files/:fileId/unlock  → { message, success }
//   GET  /api/teams/:teamId/files/:fileId/lock-status → { isLocked, lockedBy, ... }

import api from '../api/axios'
import type {
  CloudFile,
  Folder,
  FolderWithBreadcrumb,
  LockStatus,
  LockAcquireResponse,
  UploadResult,
  Comment,
  FileVersion,
  ActivityFilters,
  ActivityFeedResult,
  AnalyticsResult,
  RecycleBinResult,
  FilePreviewResponse,
  SharedLink,
  Announcement,
  DocumentSummary,
} from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// FILE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// fetchFiles
// PURPOSE:  Fetch all non-deleted files in a team, optionally filtered by
//           folder. Used by FileList to show the contents of the current folder.
//
// INPUTS:
//   teamId   — which team's files to fetch
//   folderId — (optional) filter by folder:
//               undefined → ALL files in team (no filter)
//               null      → root-level files only (folder_id IS NULL in DB)
//               number    → files inside that specific folder
//
// OUTPUTS:  Promise<CloudFile[]> — array of files with uploader info joined
//
// WHY THREE STATES FOR folderId:
//   The backend listFilesHandler checks for exactly these three cases.
//   Passing 'null' as the string "null" triggers the root-level filter.
// ---------------------------------------------------------------------------
export async function fetchFiles(
  teamId: number,
  folderId?: number | null,
  options?: {
    mimeType?: string;
    uploadedBy?: number;
    sortBy?: 'name' | 'date' | 'size';
    order?: 'asc' | 'desc';
  }
): Promise<CloudFile[]> {
  // Build the query string dynamically based on folderId value
  // We must convert null → string "null" because URL query params are strings
  const params: Record<string, string> = {}

  // Three cases:
  //   folderId = undefined → no param → backend returns all files
  //   folderId = null      → "null" string → backend returns root-level only
  //   folderId = 5         → "5" → backend returns files in folder 5
  if (folderId === null) {
    params.folderId = 'null'        // signals backend: show root-level only
  } else if (folderId !== undefined) {
    params.folderId = String(folderId) // signals backend: show this folder
  }
  // If folderId is undefined → no param sent → backend returns all team files

  if (options?.mimeType) params.mimeType = options.mimeType
  if (options?.uploadedBy) params.uploadedBy = String(options.uploadedBy)
  if (options?.sortBy) params.sortBy = options.sortBy
  if (options?.order) params.order = options.order

  const res = await api.get(`/files/teams/${teamId}/files`, { params })
  return res.data.files  // backend wraps array in { files: [...] }
}

// ---------------------------------------------------------------------------
// uploadFile
// PURPOSE:  Upload a file to the team, optionally placing it in a folder.
//           Sends multipart/form-data (required by Multer on the backend).
//
// INPUTS:
//   teamId     — which team to upload into
//   file       — the browser File object from an <input type="file"> or drop event
//   folderId   — (optional) place the file inside this folder
//   onProgress — (optional) callback for upload progress (0–100)
//                Used to drive the progress bar in FileUploadZone
//
// OUTPUTS:  Promise<UploadResult> → { message, isDuplicate, file }
//
// WHY FormData:
//   Multer (the backend file handler) reads multipart/form-data only.
//   It cannot read JSON. FormData is the browser's multipart encoder.
//   The field name 'file' MUST match what multer expects: upload.single('file')
//
// WHY override Content-Type to undefined:
//   Our axios instance sets Content-Type: application/json globally.
//   For multipart uploads, we must let the browser set its OWN Content-Type
//   which includes the boundary string (e.g. multipart/form-data; boundary=abc123).
//   If we force 'application/json', Multer cannot parse the request at all.
// ---------------------------------------------------------------------------
export async function uploadFile(
  teamId: number,
  file: File,
  folderId?: number,
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  const formData = new FormData()
  formData.append('file', file)            // must match multer's field name: 'file'
  formData.append('teamId', String(teamId)) // multipart sends everything as string

  if (folderId !== undefined) {
    formData.append('folderId', String(folderId)) // optional — only append if provided
  }

  const res = await api.post('/files/upload', formData, {
    headers: {
      'Content-Type': undefined, // ← let browser set the correct multipart boundary
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        // progressEvent.loaded = bytes sent so far
        // progressEvent.total  = total bytes to send
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
        onProgress(percent)
      }
    },
  })

  return res.data // { message, isDuplicate, file }
}

// ---------------------------------------------------------------------------
// downloadFile
// PURPOSE:  Download a file from the server and trigger a browser Save dialog.
//           The backend streams the file as a binary attachment.
//
// INPUTS:
//   fileId   — which file to download
//   filename — the name the browser will use when saving (shown in Save dialog)
//              Use file.original_name here so the user sees their own filename
//
// OUTPUTS:  Promise<void> — side effect only (triggers browser download)
//
// WHY responseType: 'blob':
//   The backend sends raw binary bytes, not JSON. Without 'blob', Axios tries
//   to parse the response as a string/JSON and corrupts binary files.
//   'blob' tells Axios: keep the response as a Blob (raw binary object).
//
// WHY URL.createObjectURL / anchor click:
//   Browsers don't expose a "save file" API directly. The pattern is:
//   1. Create a temporary in-memory URL pointing to the blob
//   2. Create a hidden <a> element with download attribute
//   3. Programmatically click it (triggers Save As dialog)
//   4. Revoke the object URL to free memory
// ---------------------------------------------------------------------------
export async function downloadFile(
  fileId: number,
  teamId: number,
  filename: string
): Promise<void> {
  const res = await api.get(`/files/${fileId}/download`, {
    params: { teamId },
    responseType: 'blob', // ← CRITICAL: tells Axios to keep response as binary Blob
  })

  // Create a temporary URL pointing to the downloaded blob in memory
  const url = URL.createObjectURL(res.data)

  // Create an invisible anchor element to trigger the browser download
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename   // this becomes the filename in Save As dialog
  document.body.appendChild(anchor)
  anchor.click()               // trigger download

  // Cleanup: remove anchor and revoke URL to free memory
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)     // ← prevents memory leak (URL holds blob in RAM)
}

// ---------------------------------------------------------------------------
// deleteFile Soft 
// PURPOSE:  Soft-delete a file (sets is_deleted = true in the DB).
//           The file moves to the Recycle Bin — it's NOT permanently gone.
//
// INPUTS:   fileId — the file to soft-delete
// OUTPUTS:  Promise<{ message: string }> — confirmation string from backend
//
// WHY SOFT DELETE:
//   Backend never removes the physical file on soft delete. This enables
//   Recycle Bin recovery (Week 7 feature). Permanent deletion is a
//   separate Recycle Bin → empty action.
// ---------------------------------------------------------------------------
export async function deleteFile(fileId: number): Promise<{ message: string }> {
  const res = await api.delete(`/files/${fileId}`)
  return res.data // { message: "File deleted. It can be recovered from the recycle bin..." }
}

// ---------------------------------------------------------------------------
// renameFile
// ---------------------------------------------------------------------------
export async function renameFile(
  fileId: number,
  teamId: number,
  newName: string
): Promise<{ message: string; file: CloudFile }> {
  const res = await api.patch(`/files/${fileId}/rename`, { teamId, newName })
  return res.data
}

// ---------------------------------------------------------------------------
// moveFile
// ---------------------------------------------------------------------------
export async function moveFile(
  fileId: number,
  teamId: number,
  folderId: number | null
): Promise<{ file: CloudFile }> {
  const res = await api.patch(`/files/${fileId}`, { teamId, folderId })
  return res.data
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLDER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// fetchFolders
// PURPOSE:  Fetch all non-deleted folders in a team.
//           The backend joins a computed 'breadcrumb' string on each folder
//           (e.g. "Finance / Budgets / Q1") useful for navigation display.
//
// INPUTS:   teamId — which team's folders to fetch
// OUTPUTS:  Promise<FolderWithBreadcrumb[]>
// ---------------------------------------------------------------------------
export async function fetchFolders(teamId: number): Promise<FolderWithBreadcrumb[]> {
  const res = await api.get(`/teams/${teamId}/folders`)
  return res.data.folders // backend wraps in { folders: [...] }
}

// ---------------------------------------------------------------------------
// createFolder
// PURPOSE:  Create a new folder inside a team, optionally nested under a parent.
//
// INPUTS:
//   teamId    — which team owns the folder
//   name      — display name for the folder (e.g. "Q1 Reports")
//   parentId  — (optional) parent folder ID for nesting; omit for root level
//
// OUTPUTS:  Promise<Folder> — the newly created folder record
//
// WHY parentId is optional:
//   Folders at the root level have parent_folder_id = null in the DB.
//   Backend treats a missing parentFolderId as null (root placement).
// ---------------------------------------------------------------------------
export async function createFolder(
  teamId: number,
  name: string,
  parentId?: number
): Promise<Folder> {
  const body: Record<string, unknown> = { teamId, name }

  if (parentId !== undefined) {
    body.parentFolderId = parentId  // only send if creating a nested folder
  }

  const res = await api.post('/folders', body)
  return res.data.folder // backend wraps in { folder: {...} }
}

// ---------------------------------------------------------------------------
// deleteFolder
// PURPOSE:  Soft-delete a folder. The backend supports three recursive modes.
//
// INPUTS:
//   folderId  — folder to delete
//   teamId    — required by backend (auth check — user must be in this team)
//   recursive — controls what happens to files inside the folder:
//               'false'  (default) — refuse if any files exist (safe mode)
//               'files'            — move files to root, then delete folder
//               'true'             — delete folder AND all files inside
//
// OUTPUTS:  Promise<{ message, deletedFiles?, orphanedFiles? }>
// ---------------------------------------------------------------------------
export async function deleteFolder(
  folderId: number,
  teamId: number,
  recursive: 'false' | 'files' | 'true' = 'false'
): Promise<{ message: string; deletedFiles?: number; orphanedFiles?: number }> {
  const res = await api.delete(`/folders/${folderId}`, {
    // Backend reads teamId from req.body and recursive from req.query
    // Axios DELETE can send both: params goes to query string, data goes to body
    params: { recursive },
    data: { teamId },
    // Tell our axios interceptor not to toast this error (we handle it in FileBrowser.tsx)
    // @ts-ignore
    skipGlobalToast: true,
  })
  return res.data
}

// ---------------------------------------------------------------------------
// renameFolder
// ---------------------------------------------------------------------------
export async function renameFolder(
  folderId: number,
  teamId: number,
  newName: string
): Promise<{ folder: Folder }> {
  const res = await api.patch(`/folders/${folderId}`, { teamId, name: newName })
  return res.data
}

// ---------------------------------------------------------------------------
// moveFolder
// ---------------------------------------------------------------------------
export async function moveFolder(
  folderId: number,
  teamId: number,
  targetFolderId: number | null
): Promise<{ folder: Folder }> {
  const res = await api.patch(`/folders/${folderId}/move`, { teamId, targetFolderId })
  return res.data
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCK FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
//
// IMPORTANT — URL PATTERN DIFFERENCE:
//   Lock routes are mounted at: /api/teams/:teamId/files/:fileId/...
//   This is DIFFERENT from file routes:   /api/files/:id/...
//   Always pass BOTH teamId and fileId to lock functions.

// ---------------------------------------------------------------------------
// lockFile
// PURPOSE:  Acquire a lease lock on a file before editing.
//           Only editors and admins can acquire locks.
//
// INPUTS:
//   teamId — team the file belongs to (needed for URL + auth)
//   fileId — the file to lock
//
// OUTPUTS:  Promise<LockAcquireResponse> → { message, lockToken, lockExpiresAt }
//
// WHY STORE lockToken IN COMPONENT STATE (not localStorage):
//   lockToken is a session secret — it proves you own the lock.
//   Storing it in localStorage would persist across tabs (a user could
//   "own" the lock from two browser tabs simultaneously, causing conflicts).
//   Component state is cleared on unmount — perfect lifetime for an edit session.
//
// THROWS 409 if another user already holds the lock.
// ---------------------------------------------------------------------------
export async function lockFile(
  teamId: number,
  fileId: number
): Promise<LockAcquireResponse> {
  const res = await api.post(`/teams/${teamId}/files/${fileId}/lock`)
  return res.data // { message, lock_token, lock_expires_at }
}


// ---------------------------------------------------------------------------
// sendHeartbeat
// PURPOSE:  Keep-alive signal. Extends the lock lease by another 30 minutes.
//           Must be called every ~25 seconds while the user is editing.
//           If heartbeats stop (tab closed, crash), the lock auto-expires via cron.
//
// INPUTS:
//   teamId    — for URL construction
//   fileId    — for URL construction
//   lockToken — proves the caller owns this lock (required by backend)
//
// OUTPUTS:  Promise<{ message, lockToken, lockExpiresAt }> — updated expiry time
//
// WHY 25 SECONDS (not 30):
//   The lease expires at 30 minutes. Sending heartbeats every 25s gives a
//   5-second buffer for network latency. The useLockManager hook handles
//   the interval — it's not the component's responsibility.
// ---------------------------------------------------------------------------
export async function sendHeartbeat(
  teamId: number,
  fileId: number,
  lockToken: string
): Promise<{ message: string; lock_token: string; lock_expires_at: string }> {
  const res = await api.post(`/teams/${teamId}/files/${fileId}/heartbeat`, {
    lockToken, // backend validates this matches the stored lock token
  })
  return res.data
}


// ---------------------------------------------------------------------------
// unlockFile
// PURPOSE:  Voluntarily release a lock when the user is done editing.
//           This should be called on component unmount (useEffect cleanup).
//
// INPUTS:
//   teamId    — for URL construction
//   fileId    — for URL construction
//   lockToken — proves the caller owns this lock
//
// OUTPUTS:  Promise<{ message: string; success: boolean }>
// ---------------------------------------------------------------------------
export async function unlockFile(
  teamId: number,
  fileId: number,
  lockToken: string
): Promise<{ message: string; success: boolean }> {
  const res = await api.post(`/teams/${teamId}/files/${fileId}/unlock`, {
    lockToken, // required — backend rejects unlock if token doesn't match
  })
  return res.data
}

// ---------------------------------------------------------------------------
// fetchLockStatus
// PURPOSE:  Check whether a file is currently locked and by whom.
//           Used by LockBanner to decide whether to show the warning.
//           Any team member (even viewer) can call this.
//
// INPUTS:
//   teamId — for URL construction + auth
//   fileId — the file to check
//
// OUTPUTS:  Promise<LockStatus>
//   { isLocked, lockedBy: { id, username, email } | null,
//     lockExpiresAt, timeRemainingSeconds, editingStartedAt }
//
// NOTE: lockToken is intentionally ABSENT from this response.
//       The backend never returns it — it's a secret for the lock owner only.
// ---------------------------------------------------------------------------
export async function fetchLockStatus(
  teamId: number,
  fileId: number
): Promise<LockStatus> {
  const res = await api.get(`/teams/${teamId}/files/${fileId}/lock-status`)
  return res.data // response is the LockStatus object directly (no wrapper)
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// searchFiles
// PURPOSE:  Full-text search across files and folders in a team.
//           Backend uses PostgreSQL ILIKE for case-insensitive matching.
//
// INPUTS:
//   teamId — restrict search to this team
//   query  — search string (backend does ILIKE %query%)
//
// OUTPUTS:  Promise<{ files: CloudFile[], folders: Folder[] }>
//           Both arrays in a single response (backend runs them in parallel)
//
// WHY COMBINED RESPONSE:
//   The backend uses Promise.all() to run both queries simultaneously.
//   Returning them together avoids two separate API calls from the client.
// ---------------------------------------------------------------------------
export async function searchFiles(
  teamId: number,
  query: string,
  options?: {
    mimeType?: string;
    uploadedBy?: number;
    folderId?: number | null;
    sortBy?: 'name' | 'date' | 'size';
    order?: 'asc' | 'desc';
    type?: 'files' | 'folders' | 'all';
  }
): Promise<{ files: CloudFile[]; folders: Folder[]; documents: DocumentSummary[] }> {
  const params: Record<string, string> = { teamId: String(teamId), query, type: options?.type || 'all' }
  if (options?.mimeType) params.mimeType = options.mimeType
  if (options?.uploadedBy) params.uploadedBy = String(options.uploadedBy)
  if (options?.folderId !== undefined) params.folderId = String(options.folderId)
  if (options?.sortBy) params.sortBy = options.sortBy
  if (options?.order) params.order = options.order

  const res = await api.get('/search', { params })

  // Backend returns a combined { results: [...] } array where items have a `resultType`
  const allResults = res.data.results || []

  const files = allResults
    .filter((r: any) => r.resultType === 'file')
    .map((r: any) => ({
      id: r.id,
      original_name: r.name,
      mime_type: r.mimeType,
      file_size: r.fileSize,
      folder_id: r.folderId,
      created_at: r.createdAt,
      uploader: r.uploadedBy
    })) as CloudFile[]

  const documents = allResults
    .filter((r: any) => r.resultType === 'document')
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      folderId: r.folderId,
      createdBy: r.createdBy,
      creatorName: r.creatorName,
      lastSaved: r.lastSaved,
      updatedAt: r.updatedAt,
    })) as DocumentSummary[]

  const folders = allResults
    .filter((r: any) => r.resultType === 'folder')
    .map((r: any) => ({
      id: r.id,
      team_id: Number(teamId),
      parent_folder_id: r.folderId,
      name: r.name,
      created_by: r.uploadedBy, // backend sets uploadedBy for folder creator
      is_deleted: false,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })) as Folder[]

  return { files, folders, documents }
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW
// ─────────────────────────────────────────────────────────────────────────────
/**
 * fetchPreview
 * For DOCX/XLSX: returns JSON with HTML content.
 * For PDF/Image: result will be streamable (can use <iframe> src instead).
 */
export async function fetchFilePreview(fileId: number, teamId: number): Promise<FilePreviewResponse> {
  const res = await api.get(`/files/${fileId}/preview`, {
    params: { teamId }
  })
  return res.data
}
// Helper to build the streaming preview URL for iframe
// Used for PDF and images — these are streamed, not JSON
export function getPreviewUrl(fileId: number, teamId: number): string {
  return `/api/files/${fileId}/preview?teamId=${teamId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchComments(teamId: number, fileId: number): Promise<Comment[]> {
  const res = await api.get(`/teams/${teamId}/files/${fileId}/comments`)
  return res.data.comments
}
export async function addComment(
  teamId: number,
  fileId: number,
  content: string
): Promise<Comment> {
  const res = await api.post(`/teams/${teamId}/files/${fileId}/comments`, { content })
  return res.data.comment
}
export async function editComment(
  teamId: number,
  commentId: number,
  content: string
): Promise<Comment> {
  const res = await api.patch(`/teams/${teamId}/comments/${commentId}`, { content })
  return res.data.comment
}
export async function deleteComment(
  teamId: number,
  commentId: number
): Promise<{ message: string }> {
  const res = await api.delete(`/teams/${teamId}/comments/${commentId}`)
  return res.data
}
// ─────────────────────────────────────────────────────────────────────────────
// FILE VERSIONS
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchVersions(teamId: number, fileId: number): Promise<FileVersion[]> {
  const res = await api.get(`/teams/${teamId}/files/${fileId}/versions`)
  // versions is always an array — return empty array if missing rather than crashing
  return Array.isArray(res.data.versions) ? res.data.versions : []
}
export async function restoreVersion(
  teamId: number,
  fileId: number,
  versionNumber: number
): Promise<{ message: string; file: CloudFile }> {
  // WHY version in URL: the backend route is /:version/restore (URL param)
  // NOT in request body. Sending it in the body means the backend never reads it.
  const res = await api.post(
    `/teams/${teamId}/files/${fileId}/versions/${versionNumber}/restore`
  )
  return res.data
}

// ---------------------------------------------------------------------------
// saveFileVersion
// PURPOSE:  Explicitly snapshot the current file state as a named version.
//           Follows the Google Docs model: user deliberately clicks "Save Version"
//           instead of creating versions on every auto-save.
//
// ROUTE:  POST /api/teams/:teamId/files/:fileId/versions
//
// INPUTS:
//   teamId      — team ownership (must be editor+)
//   fileId      — file to snapshot
//   versionName — optional label shown in version history (e.g. "Before Q3 review")
//
// OUTPUTS: { message, version } — the created FileVersion row
// ---------------------------------------------------------------------------
export async function saveFileVersion(
  teamId: number,
  fileId: number,
  versionName?: string
): Promise<{ message: string; version: FileVersion }> {
  const res = await api.post(`/teams/${teamId}/files/${fileId}/versions`, {
    ...(versionName ? { versionName } : {}),
  })
  return res.data
}
// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY FEED
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchActivity(
  teamId: number,
  filters: ActivityFilters = {}
): Promise<ActivityFeedResult> {
  const res = await api.get(`/teams/${teamId}/activity`, { params: filters })
  return res.data
}
// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchAnalytics(
  teamId: number,
  startDate?: string,
  endDate?: string
): Promise<AnalyticsResult> {
  const params: Record<string, string> = {}
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate

  const res = await api.get(`/teams/${teamId}/analytics`, { params })
  return res.data
}

export async function fetchAnalyticsSummary(
  teamId: number,
  startDate?: string,
  endDate?: string
): Promise<string> {
  const params: Record<string, string> = {}
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate

  const res = await api.get(`/teams/${teamId}/analytics/summary`, { params })
  return res.data.summary
}
// ─────────────────────────────────────────────────────────────────────────────
// RECYCLE BIN
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchRecycleBin(teamId: number): Promise<RecycleBinResult> {
  const res = await api.get(`/teams/${teamId}/recycle-bin/all`)
  return res.data
}
export async function restoreFile(teamId: number, fileId: number): Promise<{ message: string; file: CloudFile }> {
  const res = await api.post(`/teams/${teamId}/recycle-bin/files/${fileId}/restore`)
  return res.data
}
export async function restoreFolder(
  teamId: number,
  folderId: number
): Promise<{ message: string; restoredFolders: number; restoredFiles: number }> {
  const res = await api.post(`/teams/${teamId}/recycle-bin/folders/${folderId}/restore`)
  return res.data
}
export async function hardDeleteFile(teamId: number, fileId: number): Promise<{ message: string }> {
  const res = await api.delete(`/teams/${teamId}/recycle-bin/files/${fileId}`)
  return res.data
}
export async function hardDeleteFolder(teamId: number, folderId: number): Promise<{ message: string }> {
  const res = await api.delete(`/teams/${teamId}/recycle-bin/folders/${folderId}`)
  return res.data
}
export async function emptyRecycleBin(teamId: number): Promise<{ message: string; deletedFiles: number; deletedFolders: number }> {
  const res = await api.delete(`/teams/${teamId}/recycle-bin/empty`)
  return res.data
}
// =============================================================================
// SHARED LINKS
// =============================================================================

// ─── Create a share link ─────────────────────────────────────────────────────
// ROUTE: POST /api/files/:fileId/share
export async function createShareLink(
  fileId: number,
  options: {
    password?: string;
    expirationDate?: string;
    downloadLimit?: number;
  }
): Promise<{ shareLink: SharedLink; url: string }> {
  const res = await api.post(`/files/${fileId}/share`, options);
  return res.data;
}

// =============================================================================
// ANNOUNCEMENTS
// =============================================================================

// ─── Get announcements for a team ────────────────────────────────────────────
// ROUTE: GET /api/teams/:teamId/announcements
export async function fetchAnnouncements(teamId: number): Promise<Announcement[]> {
  const res = await api.get(`/teams/${teamId}/announcements`);
  return res.data.announcements ?? res.data;
}

// ─── Create an announcement ───────────────────────────────────────────────────
// ROUTE: POST /api/teams/:teamId/announcements
export async function createAnnouncement(
  teamId: number,
  data: { title: string; body: string; isPinned?: boolean }
): Promise<Announcement> {
  const res = await api.post(`/teams/${teamId}/announcements`, data);
  return res.data.announcement ?? res.data;
}
// =============================================================================
// ADD to src/api/files.ts
//
// PURPOSE: Fetch any previewable file as an authenticated blob.
// WHY blob approach instead of direct URL:
//   <img src="..."> and <iframe src="..."> make plain browser HTTP requests
//   that bypass the Axios interceptor — the JWT Authorization header is never
//   attached, so the backend's authenticate middleware rejects with 401.
//   Using Axios with responseType:'blob' attaches the JWT, gets the binary data,
//   and we create a temporary local URL the browser can render without auth.
//
// RETURNS:
//   For streamable files (PDF/images): { blobUrl: string, type: 'stream' }
//   For convertible files (DOCX/XLSX/text): { html: string, type: 'html' }
//   For unsupported files: { type: 'unsupported' }
//
// IMPORTANT: The caller must call URL.revokeObjectURL(blobUrl) when done
//   to release browser memory. We do this in a useEffect cleanup.
// =============================================================================

export type PreviewResult =
  | { type: 'stream'; blobUrl: string; mimeType: string }
  | { type: 'html'; html: string }
  | { type: 'unsupported' }

export async function fetchFilePreviewBlob(
  fileId: number,
  teamId: number,
  mimeType: string
): Promise<PreviewResult> {
  const isPdf = mimeType === 'application/pdf'
  const isImage = mimeType.startsWith('image/')

  if (isPdf || isImage) {
    // Streamable: fetch as binary blob, create object URL
    // responseType:'blob' tells Axios to return raw binary data not parse as JSON
    const res = await api.get(`/files/${fileId}/preview`, {
      params: { teamId },
      responseType: 'blob',
    })
    // createObjectURL creates a temporary browser-local URL like:
    // blob:http://localhost:5173/abc-123-def
    // This URL works in <img src> and <iframe src> without any auth headers
    // because it's a local browser resource, not a server request
    const blobUrl = URL.createObjectURL(res.data)
    return { type: 'stream', blobUrl, mimeType }
  }

  // Convertible: fetch as JSON (DOCX/XLSX/text return HTML string)
  try {
    const res = await api.get(`/files/${fileId}/preview`, {
      params: { teamId },
      // No responseType override — Axios defaults to JSON parsing
    })
    const data = res.data as FilePreviewResponse
    if (data.previewable && data.type === 'html') {
      return { type: 'html', html: data.content }
    }
    return { type: 'unsupported' }
  } catch {
    return { type: 'unsupported' }
  }
}

// Force unlock — admin only
// ROUTE: POST /api/teams/:teamId/files/:fileId/force-unlock
export async function forceUnlockFile(
  teamId: number,
  fileId: number
): Promise<{ message: string }> {
  const res = await api.post(`/teams/${teamId}/files/${fileId}/force-unlock`)
  return res.data
}


// Add to your existing files.ts API functions

export interface FileSummaryResult {
  summary: string
  fromCache: boolean
  cachedAt: string | null
  fileName: string
}

export async function fetchFileSummary(teamId: number, fileId: number): Promise<FileSummaryResult> {
  const res = await api.post<FileSummaryResult>(`/teams/${teamId}/files/${fileId}/summarize`)
  return res.data
}