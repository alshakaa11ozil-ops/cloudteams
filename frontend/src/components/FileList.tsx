// src/components/FileList.tsx
// PURPOSE: Right-panel grid/list of files in the current folder.
//          Shows file icon, name, size, uploader, lock status, and actions.
// INPUTS:
//   files         — array of CloudFile objects to display
//   folders       — array of Folder objects (only populated during search)
//   isLoading     — show skeleton if true
//   teamId        — for lock status URL and navigation
//   currentUserId — to detect if current user owns a lock
//   onFolderClick — navigate into a folder (used in search results)
//   onDeleteFile  — called when user confirms file deletion
//   formatBytes   — helper passed from parent to keep formatting centralised

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { downloadFile, fetchLockStatus } from '@/api/files'
import LockBanner from '@/components/LockBanner'
import type { CloudFile, Folder } from '@/types'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Map MIME type to a short label for display
function getMimeLabel(mime: string): string {
  if (mime.startsWith('image/')) return 'Image'
  if (mime === 'application/pdf') return 'PDF'
  if (mime.includes('word')) return 'Word'
  if (mime.includes('excel') || mime.includes('sheet')) return 'Excel'
  if (mime.includes('zip') || mime.includes('compressed')) return 'Archive'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('text/')) return 'Text'
  return 'File'
}

// Map MIME type to a colour for the icon background
function getMimeColor(mime: string): string {
  if (mime.startsWith('image/')) return 'bg-purple-100 text-purple-600'
  if (mime === 'application/pdf') return 'bg-red-100 text-red-600'
  if (mime.includes('word')) return 'bg-blue-100 text-blue-600'
  if (mime.includes('excel') || mime.includes('sheet')) return 'bg-green-100 text-green-600'
  if (mime.includes('zip') || mime.includes('compressed')) return 'bg-amber-100 text-amber-600'
  return 'bg-gray-100 text-gray-500'
}

// ─── SKELETON ─────────────────────────────────────────────────────────────────
function FileListSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map(n => (
        <div key={n} className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="h-10 w-10 bg-gray-200 rounded-lg mx-auto mb-3" />
          <div className="h-4 bg-gray-200 rounded mb-2" />
          <div className="h-3 bg-gray-100 rounded w-16 mx-auto" />
        </div>
      ))}
    </div>
  )
}

// ─── FILE CARD ────────────────────────────────────────────────────────────────
// A single file card in the grid. Has its own lock-status sub-query so each
// card independently knows whether to show a lock indicator.

interface FileCardProps {
  file: CloudFile
  teamId: number
  currentUserId: number
  folderId: number | null   // ← needed for correct optimistic-delete cache key
  onDelete: () => void
  onRename: (newName: string) => void
  onMove: () => void
  onSelect: () => void      // ← opens the FileDetailSidebar
  formatBytes: (bytes: number) => string
}

function FileCard({ file, teamId, currentUserId, folderId, onDelete, onRename, onMove, onSelect, formatBytes }: FileCardProps) {
  const [showActions, setShowActions] = useState(false)
  const queryClient = useQueryClient()

  // Fetch lock status for this specific file.
  // WHY per-card query (not bulk):
  //   Lock status can change in real-time (another user acquires/releases).
  //   Individual queries can be invalidated per-file when a Socket.io event arrives.
  //   staleTime: 15s means we don't hammer the server — React Query batches refetches.
  const lockQuery = useQuery({
    queryKey: ['lock-status', teamId, file.id],
    queryFn: () => fetchLockStatus(teamId, file.id),
    staleTime: 15_000,
    refetchInterval: 30_000, // poll every 30s as a fallback (Socket.io Week 12+)
  })

  // Download mutation — not a true mutation (no data change) but useMutation
  // gives us isPending state for the loading indicator on the button
  const downloadMutation = useMutation({
    mutationFn: () => downloadFile(file.id, file.original_name),
  })

  const lockStatus = lockQuery.data
  const isLocked = lockStatus?.isLocked ?? false
  const lockedByOther = isLocked && lockStatus?.lockedBy?.id !== currentUserId

  return (
    <div
      className="
        bg-white rounded-xl border border-gray-200 p-4
        hover:shadow-md hover:border-gray-300
        transition-all duration-150 cursor-pointer
        relative group
      "
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={onSelect}  // ← clicking the card body opens the sidebar
    >
      {/* Lock indicator dot — top-right corner */}
      {isLocked && (
        <span
          title={lockedByOther
            ? `Locked by ${lockStatus?.lockedBy?.username ?? 'another user'}`
            : 'You are editing this file'
          }
          className={`
            absolute top-2 right-2 w-2.5 h-2.5 rounded-full border-2 border-white
            ${lockedByOther ? 'bg-amber-400' : 'bg-blue-500'}
          `}
        />
      )}

      {/* File type icon */}
      <div className={`
        w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3
        ${getMimeColor(file.mime_type)}
      `}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      </div>

      {/* File name */}
      <p
        className="text-xs font-medium text-gray-900 truncate text-center mb-1"
        title={file.original_name}
      >
        {file.original_name}
      </p>

      {/* File size + type */}
      <p className="text-xs text-gray-400 text-center">
        {getMimeLabel(file.mime_type)} · {formatBytes(file.file_size)}
      </p>

      {/* Uploaded by */}
      <p className="text-xs text-gray-400 text-center mt-0.5 truncate">
        {file.uploader?.username ?? 'Unknown'}
      </p>

      {/* Lock banner — shown below card if locked by another user */}
      {lockedByOther && lockStatus?.lockedBy && (
        <div className="mt-2">
          <LockBanner
            lockedByUsername={lockStatus.lockedBy.username}
            lockExpiresAt={lockStatus.lockExpiresAt}
          />
        </div>
      )}

      {/* Hover action buttons */}
      {showActions && (
        <div className="
          absolute inset-x-0 bottom-0 rounded-b-xl
          bg-white border-t border-gray-100
          grid grid-cols-2 divide-x divide-y divide-gray-100
        ">
          {/* Download */}
          <button
            id={`download-file-${file.id}`}
            onClick={e => {
              e.stopPropagation()
              downloadMutation.mutate()
            }}
            disabled={downloadMutation.isPending}
            className="
              py-1.5 text-xs text-gray-600 hover:text-blue-600
              hover:bg-blue-50 flex items-center justify-center gap-1
              transition-colors disabled:opacity-50
            "
            title="Download"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>

          {/* Rename */}
          <button
            onClick={e => {
              e.stopPropagation()
              const newName = window.prompt('Enter new name for file:', file.original_name)
              if (newName && newName.trim() !== '' && newName !== file.original_name) {
                onRename(newName.trim())
              }
            }}
            disabled={lockedByOther}
            className="
              py-1.5 text-xs text-gray-600 hover:text-blue-600
              hover:bg-blue-50 flex items-center justify-center gap-1
              transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600
            "
            title={lockedByOther ? "File is locked" : "Rename"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>

          {/* Move */}
          <button
            onClick={e => {
              e.stopPropagation()
              onMove()
            }}
            disabled={lockedByOther}
            className="
              py-1.5 text-xs text-gray-600 hover:text-amber-600
              hover:bg-amber-50 flex items-center justify-center gap-1
              rounded-bl-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600
            "
            title={lockedByOther ? "File is locked" : "Move"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </button>

          {/* Delete */}
          <button
            id={`delete-file-${file.id}`}
            onClick={e => {
              e.stopPropagation()
              if (window.confirm(`Delete "${file.original_name}"?\nIt will be moved to the Recycle Bin.`)) {
                onDelete()
                // Optimistically remove from cache so UI updates instantly.
                // WHY folderId in the key: FileBrowser's filesQuery uses ['files', teamId, folderId]
                // Omitting folderId would target a different (non-existent) cache entry — silent no-op.
                queryClient.setQueryData(
                  ['files', teamId, folderId],
                  (old: CloudFile[] | undefined) => old?.filter(f => f.id !== file.id) ?? []
                )
              }
            }}
            disabled={lockedByOther}
            className="
              py-1.5 text-xs text-gray-600 hover:text-red-600
              hover:bg-red-50 flex items-center justify-center gap-1
              rounded-br-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600
            "
            title={lockedByOther ? "File is locked" : "Delete"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface FileListProps {
  files: CloudFile[]
  folders: Folder[]       // populated only during search
  isLoading: boolean
  teamId: number
  currentUserId: number
  onFolderClick: (folderId: number | null) => void
  onDeleteFile: (fileId: number) => void
  onRenameFile: (fileId: number, newName: string) => void
  onMoveFileRequest: (fileId: number, fileName: string, folderId: number | null) => void
  onFileClick: (file: CloudFile) => void   // ← opens the sidebar
  formatBytes: (bytes: number) => string
}

export default function FileList({
  files,
  folders,
  isLoading,
  teamId,
  currentUserId,
  onFolderClick,
  onDeleteFile,
  onRenameFile,
  onMoveFileRequest,
  onFileClick,
  formatBytes,
}: FileListProps) {

  if (isLoading) return <FileListSkeleton />

  // Empty state — no files and no folder search results
  if (files.length === 0 && folders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <svg className="w-14 h-14 text-gray-200 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
            d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
        <p className="text-base font-medium text-gray-400 mb-1">No files here yet</p>
        <p className="text-sm text-gray-300">Upload a file or create a folder to get started</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Folder results (search mode only) */}
      {folders.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Folders
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {folders.map(folder => (
              <button
                key={folder.id}
                onClick={() => onFolderClick(folder.id)}
                className="
                  bg-white rounded-xl border border-gray-200 p-4
                  hover:shadow-md hover:border-gray-300
                  transition-all duration-150 text-left
                "
              >
                <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-gray-900 truncate text-center">{folder.name}</p>
                <p className="text-xs text-gray-400 text-center mt-0.5">Folder</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* File grid */}
      {files.length > 0 && (
        <div>
          {folders.length > 0 && (
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Files
            </h3>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {files.map(file => (
              <FileCard
                key={file.id}
                file={file}
                teamId={teamId}
                currentUserId={currentUserId}
                folderId={file.folder_id}             // ← correct cache key for optimistic delete
                onDelete={() => onDeleteFile(file.id)}
                onRename={(newName) => onRenameFile(file.id, newName)}
                onMove={() => onMoveFileRequest(file.id, file.original_name, file.folder_id)}
                onSelect={() => onFileClick(file)}    // ← opens the sidebar
                formatBytes={formatBytes}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
