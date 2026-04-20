// src/pages/FileBrowser.tsx
//
// PURPOSE: Two-panel file management page.
//   Left  → FolderTree (folder hierarchy navigation)
//   Right → toolbar + FileList (files in current folder) + FileUploadZone
//
// URL pattern:
//   /teams/:id/files             → root level (folderId = null)
//   /teams/:id/files/:folderId   → specific folder
//
// WHY URL-DRIVEN NAVIGATION:
//   Storing current folder in the URL means browser back works for free,
//   users can bookmark a folder, and sharing the URL takes teammates directly there.
import { useRef } from 'react'
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchFiles, fetchFolders, deleteFile, deleteFolder, searchFiles, renameFile, renameFolder, moveFile, moveFolder } from '@/api/files'
import { fetchTeam } from '@/api/teams'
import { useAuth } from '@/hooks/useAuth'
import FolderTree from '@/components/FolderTree'
import FileList from '@/components/FileList'
import FileUploadZone from '@/components/FileUploadZone'
import CreateFolderModal from '@/components/CreateFolderModal'
import MoveModal from '@/components/MoveModal'
import DeleteFolderDialog from '@/components/DeleteFolderDialog'
import FileDetailSidebar from '@/components/FileDetailSidebar' // ← NEW
import type { CloudFile, Folder } from '@/types'

// ─── HELPER ──────────────────────────────────────────────────────────────────
// Format raw bytes as human-readable size string.
// Passed down to FileList so formatting logic lives in one place.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── SKELETON ────────────────────────────────────────────────────────────────
function FileBrowserSkeleton() {
  return (
    <div className="flex h-[calc(100vh-64px)] animate-pulse">
      <div className="w-64 border-r border-gray-200 bg-white p-4 flex-shrink-0">
        <div className="h-4 bg-gray-200 rounded w-20 mb-4" />
        {[1, 2, 3].map(n => <div key={n} className="h-8 bg-gray-100 rounded mb-2" />)}
      </div>
      <div className="flex-1 p-6">
        <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
            <div key={n} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="h-10 w-10 bg-gray-200 rounded-lg mx-auto mb-3" />
              <div className="h-4 bg-gray-200 rounded mb-2" />
              <div className="h-3 bg-gray-100 rounded w-16 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function FileBrowser() {
  // :id is the teamId, :folderId is the optional current folder
  const { id, folderId: folderParam } = useParams<{ id: string; folderId?: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // useParams always returns strings — convert to numbers
  const teamId = parseInt(id ?? '0', 10)
  // null = root level, number = specific folder
  const folderId: number | null = folderParam ? parseInt(folderParam, 10) : null

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showUpload, setShowUpload] = useState(false)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{
    files: CloudFile[]
    folders: Folder[]
  } | null>(null)

  const [folderToDelete, setFolderToDelete] = useState<{ id: number; name: string } | null>(null)
  const [itemToMove, setItemToMove] = useState<{
    id: number
    type: 'file' | 'folder'
    name: string
    currentParentId: number | null
  } | null>(null)

  // Sidebar state — which file is currently selected for the detail panel
  // null = sidebar closed, CloudFile = sidebar open showing that file's details
  const [selectedFile, setSelectedFile] = useState<CloudFile | null>(null)

  const isSearching = searchQuery.trim().length > 0

  // ── Queries ──────────────────────────────────────────────────────────────────
  const foldersQuery = useQuery({
    queryKey: ['folders', teamId],
    queryFn: () => fetchFolders(teamId),
    enabled: teamId > 0,
    staleTime: 30_000,
  })

  // Fetch team to get userRole (myRole)
  const teamQuery = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => fetchTeam(teamId),
    enabled: teamId > 0,
  })

  const filesQuery = useQuery({
    queryKey: ['files', teamId, folderId],
    queryFn: () => fetchFiles(teamId, folderId),
    enabled: teamId > 0 && !isSearching,
    staleTime: 10_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────
  const deleteFileMutation = useMutation({
    mutationFn: (fileId: number) => deleteFile(fileId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['files', teamId] }),
  })

  const deleteFolderWithChoiceMutation = useMutation({
    mutationFn: ({ fId, recursive }: { fId: number; recursive: 'false' | 'files' | 'true' }) =>
      deleteFolder(fId, teamId, recursive),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['files', teamId] }) // In case files moved to root
    },
  })

  // Safe delete attempts empty deletion. If 409, opens the dialog.
  const tryDeleteFolderMutation = useMutation({
    mutationFn: (fId: number) => deleteFolder(fId, teamId, 'false'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
    },
    onError: (error: any, fId: number) => {
      // Axios errors wrap the response inside error.response
      if (error?.response?.status === 409) {
        const folder = foldersQuery.data?.find(f => f.id === fId)
        if (folder) setFolderToDelete({ id: fId, name: folder.name })
      } else {
        alert(error?.response?.data?.error || 'Failed to delete folder.')
      }
    }
  })

  const renameFileMutation = useMutation({
    mutationFn: ({ id, newName }: { id: number; newName: string }) => renameFile(id, teamId, newName),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['files', teamId] }),
  })

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, newName }: { id: number; newName: string }) => renameFolder(id, teamId, newName),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['folders', teamId] }),
  })

  const moveFileMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number | null }) => moveFile(id, teamId, targetId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['files', teamId] }),
  })

  const moveFolderMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number | null }) => moveFolder(id, teamId, targetId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['folders', teamId] }),
  })

  // ── Search ───────────────────────────────────────────────────────────────────
  // Called on every keystroke — debounce kept simple (no extra library needed)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!q.trim()) { setSearchResults(null); return }

    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchFiles(teamId, q)
        setSearchResults(results)
      } catch {
        setSearchResults({ files: [], folders: [] })
      }
    }, 350)  // wait 350ms after last keystroke before firing
  }
  // ── Folder navigation ────────────────────────────────────────────────────────
  const goToFolder = (targetId: number | null) => {
    // Clear search when navigating to a folder
    setSearchQuery('')
    setSearchResults(null)
    if (targetId === null) {
      navigate(`/teams/${teamId}/files`)
    } else {
      navigate(`/teams/${teamId}/files/${targetId}`)
    }
  }

  // ── Derive display data ──────────────────────────────────────────────────────
  const currentFolder = foldersQuery.data?.find(f => f.id === folderId)
  // When searching — show search results; otherwise show folder contents
  const filesToShow = isSearching && searchResults
    ? searchResults.files
    : (filesQuery.data ?? [])

  const extraFolders = isSearching && searchResults
    ? searchResults.folders
    : (foldersQuery.data?.filter(f => f.parent_folder_id === folderId) ?? [])

  // ── Loading / error guards ───────────────────────────────────────────────────
  if (foldersQuery.isLoading || (filesQuery.isLoading && !isSearching)) {
    return <FileBrowserSkeleton />
  }

  if (filesQuery.isError && !isSearching) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md mx-auto text-center">
          <p className="text-red-700 font-medium mb-2">Failed to load files</p>
          <button
            onClick={() => void filesQuery.refetch()}
            className="text-sm text-red-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50 overflow-hidden">

      {/* ── LEFT: Folder Tree ──────────────────────────────────────────────── */}
      <aside className="w-64 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col overflow-hidden">
        {/* Panel header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-700">Folders</h2>
          <button
            id="create-folder-btn"
            onClick={() => setShowCreateFolder(true)}
            title="New folder"
            className="
              w-6 h-6 rounded flex items-center justify-center
              text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors
            "
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* Scrollable tree */}
        <div className="flex-1 overflow-y-auto py-2">
          <FolderTree
            folders={foldersQuery.data ?? []}
            activeFolderId={folderId}
            onFolderClick={goToFolder}
            onDeleteFolder={(fId) => tryDeleteFolderMutation.mutate(fId)}
            onRenameFolder={(id, newName) => renameFolderMutation.mutate({ id, newName })}
            onMoveFolderRequest={(id, name) => {
              const folder = foldersQuery.data?.find(f => f.id === id)
              if (folder) setItemToMove({ id, type: 'folder', name, currentParentId: folder.parent_folder_id })
            }}
          />
        </div>
      </aside>

      {/* ── RIGHT: Main content ────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-shrink-0">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
            <button
              onClick={() => goToFolder(null)}
              className="text-gray-500 hover:text-blue-600 font-medium transition-colors"
            >
              All Files
            </button>
            {folderId !== null && currentFolder && (
              <>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-gray-900 font-medium truncate">{currentFolder.name}</span>
              </>
            )}
          </div>

          {/* Search */}
          <div className="relative flex-shrink-0">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
            </svg>
            <input
              id="file-search-input"
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={e => void handleSearch(e.target.value)}
              className="
                pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                w-48
              "
            />
          </div>

          {/* Upload button */}
          <button
            id="upload-file-btn"
            onClick={() => setShowUpload(p => !p)}
            className="
              inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
            "
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload
          </button>
        </div>

        {/* Upload zone — collapsible */}
        {showUpload && (
          <div className="px-6 pt-4 flex-shrink-0">
            <FileUploadZone
              teamId={teamId}
              folderId={folderId ?? undefined}
              onUploadComplete={() => {
                void queryClient.invalidateQueries({ queryKey: ['files', teamId, folderId] })
                setShowUpload(false)
              }}
              onCancel={() => setShowUpload(false)}
            />
          </div>
        )}

        {/* Search results banner */}
        {isSearching && (
          <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between flex-shrink-0">
            <span className="text-sm text-blue-700">
              Results for <strong>"{searchQuery}"</strong>
              {' '}— {filesToShow.length} file{filesToShow.length !== 1 ? 's' : ''}
              {extraFolders.length > 0 && `, ${extraFolders.length} folder${extraFolders.length !== 1 ? 's' : ''}`}
            </span>
            <button
              onClick={() => { setSearchQuery(''); setSearchResults(null) }}
              className="text-sm text-blue-600 hover:underline font-medium"
            >
              Clear
            </button>
          </div>
        )}

        {/* File grid — scrollable area */}
        <div className="flex-1 overflow-y-auto p-6">
          <FileList
            files={filesToShow}
            folders={extraFolders}
            isLoading={filesQuery.isLoading && !isSearching}
            teamId={teamId}
            currentUserId={user?.id ?? 0}
            onFolderClick={goToFolder}
            onDeleteFile={fileId => deleteFileMutation.mutate(fileId)}
            onRenameFile={(id, newName) => renameFileMutation.mutate({ id, newName })}
            onMoveFileRequest={(id, name, folderId) => setItemToMove({ id, type: 'file', name, currentParentId: folderId })}
            onFileClick={file => setSelectedFile(file)}  // ← opens FileDetailSidebar
            formatBytes={formatBytes}
          />
        </div>
      </main>

      {/* ── File Detail Sidebar ────────────────────────────────────────────── */}
      <FileDetailSidebar
        file={selectedFile}
        teamId={teamId}
        currentUserId={user?.id ?? 0}
        userRole={teamQuery.data?.myRole ?? 'viewer'}
        onClose={() => setSelectedFile(null)}
      />

      {/* ── Create Folder Modal ────────────────────────────────────────────── */}
      {showCreateFolder && (
        <CreateFolderModal
          teamId={teamId}
          parentFolderId={folderId ?? undefined}
          onSuccess={() => {
            setShowCreateFolder(false)
            void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
          }}
          onClose={() => setShowCreateFolder(false)}
        />
      )}

      {/* ── Move Item Modal ────────────────────────────────────────────────── */}
      {itemToMove && (
        <MoveModal
          teamId={teamId}
          folders={foldersQuery.data ?? []}
          itemType={itemToMove.type}
          itemId={itemToMove.id}
          itemName={itemToMove.name}
          currentParentId={itemToMove.currentParentId}
          onMove={(targetFolderId) => {
            if (itemToMove.type === 'file') {
              moveFileMutation.mutate({ id: itemToMove.id, targetId: targetFolderId })
            } else {
              moveFolderMutation.mutate({ id: itemToMove.id, targetId: targetFolderId })
            }
            setItemToMove(null)
          }}
          onClose={() => setItemToMove(null)}
        />
      )}

      {/* ── Delete Folder Dialog ───────────────────────────────────────────── */}
      {folderToDelete && (
        <DeleteFolderDialog
          folderName={folderToDelete.name}
          onConfirm={(mode) => {
            deleteFolderWithChoiceMutation.mutate({ fId: folderToDelete.id, recursive: mode })
            setFolderToDelete(null)
            if (folderToDelete.id === folderId) {
              goToFolder(null) // Redirect to parent if currently inside deleted folder
            }
          }}
          onClose={() => setFolderToDelete(null)}
        />
      )}
    </div>
  )
}
