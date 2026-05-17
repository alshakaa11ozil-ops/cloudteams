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
import { useState, useEffect, useMemo, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import socket from '../api/socket'
import { SOCKET_EVENTS } from '../socketEvents'
import toast from 'react-hot-toast'
import { fetchFiles, fetchFolders, deleteFile, deleteFolder, searchFiles, renameFile, renameFolder, moveFile, moveFolder } from '../api/files'
import { fetchTeam } from '../api/teams'

import { Popover, Transition } from '@headlessui/react'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { useAuth } from '../hooks/useAuth'
import { fetchDocuments, createDocument, deleteDocument, renameDocument, moveDocument } from '../api/documents'
import FolderTree from '../components/FolderTree'
import FileList from '../components/FileList'
import FileUploadZone from '../components/FileUploadZone'
import CreateFolderModal from '../components/CreateFolderModal'
import MoveModal from '../components/MoveModal'
import DeleteFolderDialog from '../components/DeleteFolderDialog'
import FileDetailSidebar from '../components/FileDetailSidebar'
import DocumentDetailSidebar from '../components/DocumentDetailSidebar'
import ShareLinkModal from '../components/ShareLinkModal'
import type { CloudFile, Folder, DocumentSummary } from '../types'

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
    documents: DocumentSummary[]
  } | null>(null)
  const [searchOptions, setSearchOptions] = useState<{
    mimeType?: string;
    uploadedBy?: number;
    folderId?: number | null;
    sortBy: 'name' | 'date' | 'size';
    order: 'asc' | 'desc';
  }>({
    sortBy: 'date',
    order: 'desc'
  })


  const [folderToDelete, setFolderToDelete] = useState<{ id: number; name: string } | null>(null)
  const [docToDelete, setDocToDelete] = useState<{ id: number; title: string } | null>(null)
  const [itemToMove, setItemToMove] = useState<{
    id: number
    type: 'file' | 'folder' | 'document'
    name: string
    currentParentId: number | null
  } | null>(null)

  // Sidebar state — which file is currently selected for the detail panel
  // null = sidebar closed, CloudFile = sidebar open showing that file's details
  const [selectedFile, setSelectedFile] = useState<CloudFile | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<DocumentSummary | null>(null)
  const [itemToShare, setItemToShare] = useState<{ type: 'file' | 'folder', id: number, name: string } | null>(null)

  // Documents section state
  const [isCreatingDoc, setIsCreatingDoc] = useState(false)

  const isSearching = searchResults !== null

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
    queryKey: ['files', teamId, folderId, searchOptions],
    queryFn: () => fetchFiles(teamId, folderId, searchOptions),
    enabled: teamId > 0 && !isSearching,
    staleTime: 10_000,
  })

  const activeDocFolderId = searchOptions.folderId !== undefined ? searchOptions.folderId : folderId

  // Documents query — native CloudTeams documents in this folder (or all if activeDocFolderId is undefined)
  const documentsQuery = useQuery({
    queryKey: ['documents', teamId, activeDocFolderId],
    queryFn: () => fetchDocuments(
      String(teamId), 
      activeDocFolderId === null ? 'null' : (activeDocFolderId === undefined ? undefined : String(activeDocFolderId))
    ),
    enabled: teamId > 0 && !isSearching,
    staleTime: 30_000,
  })

  // Memoize document processing so they respect UI filters and sorts
  const processedDocuments = useMemo(() => {
    if (!documentsQuery.data) return []
    let docs = [...documentsQuery.data]

    // 1. Filter out documents if the user is looking for a specific file MIME type
    if (searchOptions.mimeType) {
       return []
    }

    // 2. Filter by uploader
    if (searchOptions.uploadedBy) {
       docs = docs.filter(doc => doc.createdBy === searchOptions.uploadedBy)
    }

    // 3. Sort
    docs.sort((a, b) => {
      const orderMult = searchOptions.order === 'asc' ? 1 : -1
      if (searchOptions.sortBy === 'name') {
        return a.title.localeCompare(b.title) * orderMult
      }
      if (searchOptions.sortBy === 'size') {
        return 0 // Documents don't have a file size metric here
      }
      // Default to date
      const dateA = new Date(a.createdAt).getTime()
      const dateB = new Date(b.createdAt).getTime()
      return (dateA - dateB) * orderMult
    })

    return docs
  }, [documentsQuery.data, searchOptions])

  // ── Mutations ────────────────────────────────────────────────────────────────
  const deleteFileMutation = useMutation({
    mutationFn: (fileId: number) => deleteFile(fileId),
    onSuccess: (_data, fileId) => {
      void queryClient.invalidateQueries({ queryKey: ['files', teamId, folderId] })
      // Also remove from active search results so stale items don't linger
      if (searchResults) {
        setSearchResults(prev => prev
          ? { ...prev, files: prev.files.filter(f => f.id !== fileId) }
          : null
        )
      }
      toast.success('File moved to recycle bin')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to delete file')
    }
  })

  const deleteFolderWithChoiceMutation = useMutation({
    mutationFn: ({ fId, recursive }: { fId: number; recursive: 'false' | 'files' | 'true' }) =>
      deleteFolder(fId, teamId, recursive),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['files', teamId] }) // In case files moved to root
      toast.success('Folder deleted')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to delete folder')
    }
  })

  // Safe delete attempts empty deletion. If 409, opens the dialog.
  const tryDeleteFolderMutation = useMutation({
    mutationFn: (fId: number) => deleteFolder(fId, teamId, 'false'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
      toast.success('Folder deleted')
    },
    onError: (error: any, fId: number) => {
      // Axios errors wrap the response inside error.response
      if (error?.response?.status === 409) {
        const folder = foldersQuery.data?.find(f => f.id === fId)
        if (folder) setFolderToDelete({ id: fId, name: folder.name })
      } else {
        toast.error(error?.response?.data?.error || 'Failed to delete folder.')
      }
    }
  })

  const renameFileMutation = useMutation({
    mutationFn: ({ id, newName }: { id: number; newName: string }) => renameFile(id, teamId, newName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
      toast.success('File renamed')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to rename file')
    }
  })

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, newName }: { id: number; newName: string }) => renameFolder(id, teamId, newName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
      toast.success('Folder renamed')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to rename folder')
    }
  })

  const moveFileMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number | null }) => moveFile(id, teamId, targetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
      toast.success('File moved')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to move file')
    }
  })

  const moveFolderMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number | null }) => moveFolder(id, teamId, targetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
      toast.success('Folder moved')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to move folder')
    }
  })

  const renameDocumentMutation = useMutation({
    mutationFn: ({ id, newName }: { id: number; newName: string }) => renameDocument(String(teamId), String(id), newName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
      toast.success('Document renamed')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to rename document')
    }
  })

  const moveDocumentMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number | null }) => moveDocument(teamId, id, targetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
      toast.success('Document moved')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to move document')
    }
  })

  // Create document — inserts the DB row first, then navigates to the editor
  // WHY ROW FIRST: Hocuspocus.onAuthenticate() checks the DB for the document.
  // If the row doesn't exist the WebSocket is rejected and content is lost.
  const createDocMutation = useMutation({
    mutationFn: () => createDocument(String(teamId), { title: 'Untitled Document' }),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
      navigate(`/teams/${teamId}/documents/${doc.id}`)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to create document')
      setIsCreatingDoc(false)
    }
  })

  // Delete document — soft delete, not shown in recycle bin (Day 5 scope)
  const deleteDocMutation = useMutation({
    mutationFn: (docId: number) => deleteDocument(String(teamId), String(docId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
      toast.success('Document deleted')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to delete document')
    }
  })

  const handleCreateDocument = () => {
    setIsCreatingDoc(true)
    createDocMutation.mutate()
  }

  // ── Search ───────────────────────────────────────────────────────────────────
  const executeSearch = async (q: string, options = searchOptions) => {
    if (!q.trim()) {
      setSearchResults(null)
      return
    }
    try {
      const results = await searchFiles(teamId, q, options)
      setSearchResults(results)
    } catch {
      setSearchResults({ files: [], folders: [], documents: [] })
    }
  }

  // Re-trigger search when filters change
  useEffect(() => {
    if (searchQuery.trim()) {
      executeSearch(searchQuery, searchOptions)
    }
  }, [searchOptions])
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

  const documentsToShow = isSearching && searchResults
    ? searchResults.documents
    : processedDocuments

  // ── Real-time Updates (Collaboration) ───────────────────────────────────────
  useEffect(() => {
    if (teamId <= 0) return

    // 1. Connect and join the team room
    socket.connect()
    socket.emit('join-team', { teamId })

    // ── Handle remote locks (Week 8)
    const handleLockUpdate = (payload: { fileId: number }) => {
      void queryClient.invalidateQueries({ queryKey: ['lock-status', teamId, payload.fileId] })
    }

    socket.on(SOCKET_EVENTS.FILE_LOCKED, handleLockUpdate)
    socket.on(SOCKET_EVENTS.FILE_UNLOCKED, handleLockUpdate)
    socket.on(SOCKET_EVENTS.FILE_LOCK_EXPIRED, handleLockUpdate)

    // ── Cleanup
    return () => {
      socket.off(SOCKET_EVENTS.FILE_LOCKED, handleLockUpdate)
      socket.off(SOCKET_EVENTS.FILE_UNLOCKED, handleLockUpdate)
      socket.off(SOCKET_EVENTS.FILE_LOCK_EXPIRED, handleLockUpdate)
      socket.emit('leave-team', { teamId })
      socket.disconnect()
    }
  }, [teamId, user?.id, queryClient])

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
                {/* Share Folder Button */}
                {(teamQuery.data?.myRole === 'admin' || teamQuery.data?.myRole === 'editor') && (
                  <button
                    onClick={() => setItemToShare({ type: 'folder', id: currentFolder.id, name: currentFolder.name })}
                    className="ml-2 flex items-center gap-1 px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-blue-600 transition-colors shadow-sm"
                    title="Share this folder"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share
                  </button>
                )}
              </>
            )}
          </div>

          {/* Search */}
          <div className="relative flex-shrink-0 flex items-center gap-2">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
              </svg>
              <input
                id="file-search-input"
                type="text"
                placeholder="Search files (Press Enter)..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value)
                  if (!e.target.value.trim()) setSearchResults(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    executeSearch(searchQuery)
                  }
                }}
                className="
                  pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                  w-56
                "
              />
            </div>
            
            {/* Filter Toggle */}
            <Popover className="relative">
              {({ open, close }) => (
                <>
                  <Popover.Button
                    className={`
                      p-1.5 rounded-lg border transition-all flex items-center gap-1.5 focus:outline-none
                      ${open || Object.keys(searchOptions).length > 2 
                        ? 'bg-blue-50 border-blue-200 text-blue-600' 
                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}
                    `}
                    title="Search Filters"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    {Object.keys(searchOptions).length > 2 && <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />}
                  </Popover.Button>

                  {/* Advanced Filter Dropdown */}
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-200"
                    enterFrom="opacity-0 translate-y-1"
                    enterTo="opacity-100 translate-y-0"
                    leave="transition ease-in duration-150"
                    leaveFrom="opacity-100 translate-y-0"
                    leaveTo="opacity-0 translate-y-1"
                  >
                    <Popover.Panel className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 z-[100] p-4 focus:outline-none">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-800">Search Filters</h3>
                    <button 
                      onClick={() => {
                        setSearchOptions({ sortBy: 'date', order: 'desc' })
                        close()
                      }}
                      className="text-[11px] font-bold text-blue-600 hover:underline uppercase tracking-tight"
                    >
                      Reset All
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Sort By */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Sort By</label>
                      <div className="flex gap-1 bg-gray-50 p-1 rounded-lg">
                        {(['name', 'date', 'size'] as const).map(s => (
                          <button
                            key={s}
                            onClick={() => setSearchOptions(prev => ({ ...prev, sortBy: s }))}
                            className={`
                              flex-1 py-1 px-2 text-[11px] font-bold rounded-md transition-all
                              ${searchOptions.sortBy === s ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}
                            `}
                          >
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Order */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Order</label>
                      <div className="flex gap-1 bg-gray-50 p-1 rounded-lg">
                        {(['desc', 'asc'] as const).map(o => (
                          <button
                            key={o}
                            onClick={() => setSearchOptions(prev => ({ ...prev, order: o }))}
                            className={`
                              flex-1 py-1 px-2 text-[11px] font-bold rounded-md transition-all
                              ${searchOptions.order === o ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}
                            `}
                          >
                            {o === 'desc' ? 'Newest/Largest' : 'Oldest/Smallest'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* MIME Type */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">File Type</label>
                      <select
                        value={searchOptions.mimeType || ''}
                        onChange={e => setSearchOptions(prev => ({ ...prev, mimeType: e.target.value || undefined }))}
                        className="w-full bg-gray-50 border-none rounded-lg py-1.5 px-3 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">All Types</option>
                        <option value="application/pdf">PDF Documents</option>
                        <option value="image/">Images</option>
                        <option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">Word Docs</option>
                        <option value="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">Excel Sheets</option>
                        <option value="text/">Text Files</option>
                      </select>
                    </div>

                    {/* Member Filter */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Uploaded By</label>
                      <select
                        value={searchOptions.uploadedBy || ''}
                        onChange={e => setSearchOptions(prev => ({ ...prev, uploadedBy: e.target.value ? parseInt(e.target.value) : undefined }))}
                        className="w-full bg-gray-50 border-none rounded-lg py-1.5 px-3 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Anyone</option>
                        {teamQuery.data?.members?.map(m => (
                          <option key={m.user.id} value={m.user.id}>
                            {m.user.id === user?.id ? 'Me' : m.user.username}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Folder Context */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Search In</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSearchOptions(prev => ({ ...prev, folderId: undefined }))}
                          className={`flex-1 py-1.5 px-3 text-[11px] font-bold rounded-lg border transition-all ${searchOptions.folderId === undefined ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                        >
                          Everywhere
                        </button>
                        <button
                          disabled={folderId === null}
                          onClick={() => setSearchOptions(prev => ({ ...prev, folderId: folderId }))}
                          className={`flex-1 py-1.5 px-3 text-[11px] font-bold rounded-lg border transition-all disabled:opacity-30 ${searchOptions.folderId !== undefined ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                        >
                          This Folder
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-50">
                    <button
                      onClick={() => close()}
                      className="w-full bg-blue-600 text-white py-2 rounded-lg text-xs font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
                    >
                      Apply Filters
                    </button>
                  </div>
                </Popover.Panel>
              </Transition>
              </>
            )}
            </Popover>
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

          {/* New Document button — Addition 2 from Day 5 review */}
          {(teamQuery.data?.myRole === 'admin' || teamQuery.data?.myRole === 'editor') && (
            <button
              id="new-document-btn"
              onClick={handleCreateDocument}
              disabled={isCreatingDoc}
              title="Create a new collaborative document"
              className="
                inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex-shrink-0
                disabled:opacity-60 disabled:cursor-not-allowed
                focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1
              "
            >
              {isCreatingDoc ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              {isCreatingDoc ? 'Creating...' : 'New Document'}
            </button>
          )}
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
              {documentsToShow.length > 0 && `, ${documentsToShow.length} document${documentsToShow.length !== 1 ? 's' : ''}`}
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

          {/* ── Documents section ──────────────────────────────────────────── */}
          {/* WHY ABOVE FILES: Documents are first-class objects in CloudTeams.
              Placing them above the file grid makes them easy to discover.
              Users naturally look "above" files for richer content. */}
          {documentsToShow.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                {/* Section icon + title */}
                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Documents
                </h3>
                <span className="text-xs text-gray-400">({documentsToShow.length})</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {documentsToShow.map(doc => (
                  <div
                    key={doc.id}
                    className="group relative bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => {
                      setSelectedDocument(doc)
                      setSelectedFile(null)
                    }}
                    onDoubleClick={() => navigate(`/teams/${teamId}/documents/${doc.id}`)}
                  >
                    {/* Document icon */}
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center mb-3 mx-auto">
                      <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>

                    {/* Title */}
                    <p className="text-xs font-medium text-gray-800 text-center truncate mb-1" title={doc.title}>
                      {doc.title}
                    </p>

                    {/* Metadata */}
                    <p className="text-[10px] text-gray-400 text-center">
                      {doc.creatorName ?? 'Unknown'}
                    </p>
                    {doc.lastSaved && (
                      <p className="text-[10px] text-gray-400 text-center mt-0.5">
                        Saved {new Date(doc.lastSaved).toLocaleDateString()}
                      </p>
                    )}

                    {/* Options overlay — editor+ only */}
                    {(teamQuery.data?.myRole === 'admin' || teamQuery.data?.myRole === 'editor') && (
                      <div className="
                        absolute top-1 right-1 flex items-center gap-0.5
                        opacity-0 group-hover:opacity-100 transition-opacity
                      ">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const newName = window.prompt('Enter new name for document:', doc.title)
                            if (newName && newName.trim() !== '' && newName !== doc.title) {
                              renameDocumentMutation.mutate({ id: doc.id, newName: newName.trim() })
                            }
                          }}
                          title="Rename document"
                          className="w-7 h-7 rounded bg-white/90 shadow-sm border border-gray-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-white transition-all"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setItemToMove({ id: doc.id, type: 'document', name: doc.title, currentParentId: doc.folderId ?? null })
                          }}
                          title="Move document"
                          className="w-7 h-7 rounded bg-white/90 shadow-sm border border-gray-100 flex items-center justify-center text-gray-400 hover:text-amber-600 hover:bg-white transition-all"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDocToDelete({ id: doc.id, title: doc.title })
                          }}
                          title="Delete document"
                          className="w-7 h-7 rounded bg-white/90 shadow-sm border border-gray-100 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-white transition-all"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Divider between docs and files */}
              <div className="mt-6 mb-2 border-t border-gray-100" />
            </div>
          )}

          <FileList
            files={filesToShow}
            folders={extraFolders}
            isLoading={filesQuery.isLoading && !isSearching}
            teamId={teamId}
            currentUserId={user?.id ?? 0}
            onFolderClick={goToFolder}
            onDeleteFile={fileId => deleteFileMutation.mutate(fileId)}
            hideDelete={isSearching}
            onRenameFile={(id, newName) => renameFileMutation.mutate({ id, newName })}
            onMoveFileRequest={(id, name, folderId) => setItemToMove({ id, type: 'file', name, currentParentId: folderId })}
            onFileClick={file => {
              setSelectedFile(file)
              setSelectedDocument(null)
            }}
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
        onShare={() => selectedFile && setItemToShare({ type: 'file', id: selectedFile.id, name: selectedFile.original_name })}
        onClose={() => setSelectedFile(null)}
      />

      <DocumentDetailSidebar
        document={selectedDocument}
        teamId={teamId}
        currentUserId={user?.id ?? 0}
        isAdmin={teamQuery.data?.myRole === 'admin'}
        onClose={() => setSelectedDocument(null)}
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
            } else if (itemToMove.type === 'folder') {
              moveFolderMutation.mutate({ id: itemToMove.id, targetId: targetFolderId })
            } else {
              moveDocumentMutation.mutate({ id: itemToMove.id, targetId: targetFolderId })
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

      {/* ── Share Link Modal ────────────────────────────────────────────────── */}
      {itemToShare && (
        <ShareLinkModal
          itemType={itemToShare.type}
          itemId={itemToShare.id}
          teamId={teamId}
          itemName={itemToShare.name}
          onClose={() => setItemToShare(null)}
        />
      )}

      {/* ── Delete Document Modal ───────────────────────────────────────────── */}
      {docToDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden flex flex-col">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Document</h2>
              <p className="text-sm text-gray-500">
                Are you sure you want to delete <span className="font-medium text-gray-900">"{docToDelete.title}"</span>? It will be moved to the Recycle Bin.
              </p>
            </div>
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setDocToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteDocMutation.mutate(docToDelete.id)
                  setDocToDelete(null)
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-lg shadow-sm hover:bg-red-700 transition-colors"
              >
                Delete Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
