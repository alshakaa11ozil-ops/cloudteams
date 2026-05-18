// =============================================================================
// src/pages/DocumentEditor.tsx
//
// PURPOSE: Full-page route wrapper for the collaborative editor.
//          Handles two entry points:
//
//   1. Editing an EXISTING FILE (via URL: /teams/:id/files/:fileId/edit)
//      - Calls GET /api/files/:fileId/open-editor?teamId=X
//      - Gets back either { hasExistingState: true } or { content, contentType }
//      - documentName = "file-{fileId}"
//
//   2. Editing a NATIVE CLOUDTEAMS DOCUMENT (via URL: /teams/:id/documents/:docId)
//      - Calls GET /api/teams/:teamId/documents/:docId to get the title
//      - documentName = "doc-{docId}"
//      - Hocuspocus handles content persistence automatically
//
// WHY SEPARATE FROM CollaborativeEditor:
//   DocumentEditor handles routing, data fetching, and the header/toolbar UI.
//   CollaborativeEditor is a pure component — it only cares about the editor.
//   This separation makes CollaborativeEditor reusable (e.g., embed in modals).
//
// LOADING STATES:
//   1. 'loading'   — fetching open-editor or document metadata from REST API
//   2. 'ready'     — data loaded, CollaborativeEditor is mounting
//   3. 'connected' — editor signals it's connected and content is inserted
//   The loading skeleton prevents layout shift while the editor initializes.
//
// DAY 5 ADDITIONS:
//   - Native docs: fetch title from /api/teams/:teamId/documents/:docId
//   - Inline title editing (Addition 1 from review) — PATCH on blur
//   - Export .docx button with loading state (Addition 3)
//   - Error state for non-existent docIds (Problem 6 fix)
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Loader2, Download, History, Share2 } from 'lucide-react'
import CollaborativeEditor, { type DocumentName } from '../components/editor/CollaborativeEditor'
import type { AxiosError } from 'axios'
import axios from 'axios'
import { useAuth } from '../hooks/useAuth'
import { fetchDocument, renameDocument, lockDocument, unlockDocument, forceUnlockDocument } from '../api/documents'
import { exportToDocx } from '../utils/exportDocx'
import socket from '../api/socket'
import { SOCKET_EVENTS } from '../socketEvents'
import toast from 'react-hot-toast'

import VersionHistoryPanel from '../components/editor/VersionHistoryPanel'
import ShareLinkModal from '../components/ShareLinkModal'
import DocumentShareLinksPanel from '../components/editor/DocumentShareLinksPanel'
import type { TeamRole } from '../types'
import type { Editor } from '@tiptap/react'

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

type EditorMode = 'file' | 'document'

interface FileEditorData {
  hasExistingState: boolean
  contentType?: 'text' | 'html'
  content?: string
}

// ---------------------------------------------------------------------------
// COMPONENT: DocumentEditor
// ---------------------------------------------------------------------------
export default function DocumentEditor() {
  const { id: teamId, fileId, docId } = useParams<{
    id: string       // team ID (from /teams/:id/...)
    fileId?: string  // present when editing an existing file
    docId?: string   // present when editing a native document
  }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Determine the editing mode from the URL params
  const mode: EditorMode = fileId ? 'file' : 'document'
  const resourceId = mode === 'file' ? fileId : docId

  // documentName is what Hocuspocus uses to route to the correct DB table.
  const documentName: DocumentName = mode === 'file'
    ? `file-${resourceId}` as DocumentName
    : `doc-${resourceId}` as DocumentName

  // ── Title state ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState<string>('Untitled Document')

  // Inline title editing (Addition 1 — Notion-style click-to-rename in header)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  // ── Page load state ────────────────────────────────────────────────────────
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'connected'>('loading')
  const [error, setError] = useState<string | null>(null)

  // Initial content from the backend (only for first-open of a file)
  const [initialContent, setInitialContent] = useState<
    { type: 'text' | 'html'; content: string } | undefined
  >()

  // ── Export state ───────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false)
  // We hold a ref to the TipTap Editor instance for export
  // CollaborativeEditor exposes it via the onEditorReady callback
  const editorRef = useRef<Editor | null>(null)

  // ── Version History state ──────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)

  // ── Share Modal state ──────────────────────────────────────────────────────
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [showShareLinks, setShowShareLinks] = useState(false)
  const [userRole, setUserRole] = useState<TeamRole>('viewer')

  // ── Lock state ─────────────────────────────────────────────────────────────
  // lockOwnerUserId: who currently holds the lock (null = unlocked)
  // isLockedByMe: the current user is the one who locked it
  // isLockedByOther: document is locked by a different user → enforce readOnly
  const [lockOwnerUserId, setLockOwnerUserId] = useState<number | null>(null)
  const [lockExpiresAt, setLockExpiresAt] = useState<string | null>(null)
  const [isLockLoading, setIsLockLoading] = useState(false)

  // --------------------------------------------------------------------------
  // SOCKET: Real-time lock updates
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!socket || !docId) return

    const handleLocked = (payload: any) => {
      if (payload.documentId === parseInt(docId, 10)) {
        setLockOwnerUserId(payload.lockedBy)
        setLockExpiresAt(payload.expiresAt)
        if (payload.lockedBy !== user?.id) {
          toast.error('This document has been locked by another user. You are now in View-Only mode.', { duration: 5000 })
        }
      }
    }

    const handleUnlocked = (payload: any) => {
      if (payload.documentId === parseInt(docId, 10)) {
        if (lockOwnerUserId !== null && lockOwnerUserId !== user?.id) {
          toast.success('Document unlocked. You can now edit.')
        }
        setLockOwnerUserId(null)
        setLockExpiresAt(null)
      }
    }

    socket.on(SOCKET_EVENTS.DOCUMENT_LOCKED, handleLocked)
    socket.on(SOCKET_EVENTS.DOCUMENT_UNLOCKED, handleUnlocked)

    return () => {
      socket.off(SOCKET_EVENTS.DOCUMENT_LOCKED, handleLocked)
      socket.off(SOCKET_EVENTS.DOCUMENT_UNLOCKED, handleUnlocked)
    }
  }, [socket, docId, user?.id, lockOwnerUserId])

  // --------------------------------------------------------------------------
  // TIMER: Auto-expire locks
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!lockExpiresAt) return

    const checkExpiry = () => {
      if (new Date(lockExpiresAt) <= new Date()) {
        if (lockOwnerUserId !== null && lockOwnerUserId !== user?.id) {
          toast.success('Document lock expired. You can now edit.')
        }
        setLockOwnerUserId(null)
        setLockExpiresAt(null)
      }
    }

    // Check immediately and then every 5 seconds
    checkExpiry()
    const interval = setInterval(checkExpiry, 5000)
    return () => clearInterval(interval)
  }, [lockExpiresAt, lockOwnerUserId, user?.id])

  // --------------------------------------------------------------------------
  // FETCH: Document metadata or file open-editor data
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!teamId || !resourceId) {
      setError('Invalid URL — missing team or resource ID')
      return
    }

    if (mode === 'document') {
      // Problem 6 fix: fetch document metadata to:
      //   1. Get the real title (not just "New Document")
      //   2. Detect invalid/deleted docIds — show error before connecting Hocuspocus
      const loadDoc = async () => {
        try {
          const doc = await fetchDocument(teamId, docId!)
          setTitle(doc.title)
          setEditTitle(doc.title)
          // Hydrate lock state from the initial document fetch
          setLockOwnerUserId(doc.lockOwnerUserId ?? null)
          setLockExpiresAt(doc.lockExpiresAt ?? null)

          // Fetch user role for this team (used by ShareLinksPanel + force-unlock)
          try {
            const { default: api } = await import('../api/axios')
            const memberRes = await api.get(`/teams/${teamId}/members/me`)
            if (memberRes.data?.role) setUserRole(memberRes.data.role)
          } catch { /* non-critical — role stays 'viewer' as default */ }

          setLoadState('ready')
        } catch (err: any) {
          const status = err.response?.status
          if (status === 404) {
            setError('This document does not exist or has been deleted.')
          } else {
            setError(err.response?.data?.error || 'Failed to load document')
          }
        }
      }
      loadDoc()
      return
    }

    // Existing file — call open-editor to get content + verify access
    const fetchEditorData = async () => {
      try {
        const token = localStorage.getItem('cloudteams_token')
        const response = await axios.get<FileEditorData & { fileName?: string }>(
          `${import.meta.env.VITE_API_URL}/files/${fileId}/open-editor`,
          {
            params: { teamId },
            headers: { Authorization: `Bearer ${token}` }
          }
        )

        const data = response.data

        if (!data.hasExistingState && data.content && data.contentType) {
          setInitialContent({ type: data.contentType, content: data.content })
        }

        setTitle(data.fileName ?? `Editing file ${fileId}`)
        setEditTitle(data.fileName ?? `Editing file ${fileId}`)
        setLoadState('ready')

      } catch (err) {
        const axiosErr = err as AxiosError<{ error: string }>
        const message = axiosErr.response?.data?.error || 'Failed to open file for editing'
        setError(message)
      }
    }

    fetchEditorData()
  }, [teamId, fileId, docId, mode, resourceId])

  // --------------------------------------------------------------------------
  // HANDLER: Save title on blur (Addition 1 — inline title editing)
  // --------------------------------------------------------------------------
  const handleTitleSave = async () => {
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === title || mode !== 'document') {
      setIsEditingTitle(false)
      setEditTitle(title)  // revert to original if empty
      return
    }

    setIsSavingTitle(true)
    try {
      await renameDocument(teamId!, docId!, trimmed)
      setTitle(trimmed)
    } catch {
      // Silently revert on error — don't break the editing session
      setEditTitle(title)
    } finally {
      setIsEditingTitle(false)
      setIsSavingTitle(false)
    }
  }

  // --------------------------------------------------------------------------
  // HANDLER: Export .docx (Addition 3 — with loading state)
  // --------------------------------------------------------------------------
  const handleExport = async () => {
    console.log('[handleExport] Clicked! isExporting:', isExporting, 'editorRef:', !!editorRef.current)
    if (!editorRef.current || isExporting) return
    setIsExporting(true)
    try {
      const json = editorRef.current.getJSON()
      console.log('[handleExport] Editor JSON generated successfully')
      await exportToDocx(json, title)
      console.log('[handleExport] Export completed successfully')
    } catch (err) {
      console.error('[Export] Failed to generate .docx:', err)
    } finally {
      setIsExporting(false)
    }
  }

  // --------------------------------------------------------------------------
  // HANDLER: Lock / Unlock document
  // --------------------------------------------------------------------------
  const isLockActive = !!lockOwnerUserId &&
    !!lockExpiresAt &&
    new Date(lockExpiresAt) > new Date()

  const isLockedByMe = isLockActive && lockOwnerUserId === user?.id
  const isLockedByOther = isLockActive && lockOwnerUserId !== user?.id

  const handleToggleLock = async () => {
    if (!teamId || !docId || isLockLoading) return
    setIsLockLoading(true)
    try {
      if (isLockedByMe) {
        await unlockDocument(teamId, docId)
        setLockOwnerUserId(null)
        setLockExpiresAt(null)
      } else {
        const result = await lockDocument(teamId, docId)
        setLockOwnerUserId(result.lockOwnerUserId)
        setLockExpiresAt(result.lockExpiresAt)
      }
    } catch (err: any) {
      console.error('[DocumentEditor] Lock toggle failed:', err.response?.data?.error || err.message)
    } finally {
      setIsLockLoading(false)
    }
  }

  const handleForceUnlock = async () => {
    if (!teamId || !docId || isLockLoading) return
    if (!window.confirm('Are you sure you want to force-unlock this document? This will kick out the current editor!')) return

    setIsLockLoading(true)
    try {
      await forceUnlockDocument(teamId, docId)
      setLockOwnerUserId(null)
      setLockExpiresAt(null)
    } catch (err: any) {
      console.error('[DocumentEditor] Force unlock failed:', err.response?.data?.error || err.message)
    } finally {
      setIsLockLoading(false)
    }
  }

  // --------------------------------------------------------------------------
  // RENDER: Loading skeleton
  // --------------------------------------------------------------------------
  if (loadState === 'loading') {
    return (
      <div className="h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm">Opening editor...</p>
        </div>
      </div>
    )
  }

  // --------------------------------------------------------------------------
  // RENDER: Error state or Auth guard
  // --------------------------------------------------------------------------
  if (error || !user) {
    return (
      <div className="h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <FileText className="w-8 h-8 text-red-400" />
          </div>
          <p className="text-slate-300 font-medium">
            {!user ? 'Authentication required' : error}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  // --------------------------------------------------------------------------
  // RENDER: Editor page
  // --------------------------------------------------------------------------
  return (
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">

      {/* ── Lock Banner (locked by someone else) ──────────────────────────── */}
      {isLockedByOther && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-500/20 border-b border-amber-500/30 text-amber-300 text-xs font-medium">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>
            This document is currently locked for editing by another user.
            {lockExpiresAt && (
              <> Lock expires at {new Date(lockExpiresAt).toLocaleTimeString()}.</>
            )}
            &nbsp;You are in <strong>read-only</strong> mode.
          </span>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}

      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">

        {/* Back navigation */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {/* Document title — click to edit (Addition 1) */}
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />

          {isEditingTitle && mode === 'document' ? (
            // Editable input — only for native documents (files have names from disk)
            <input
              ref={titleInputRef}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setEditTitle(title)
                  setIsEditingTitle(false)
                }
              }}
              autoFocus
              maxLength={255}
              className="
                bg-transparent border-b border-indigo-500 text-slate-200
                font-medium text-sm focus:outline-none w-48 max-w-xs
              "
            />
          ) : (
            <span
              onClick={() => {
                if (mode === 'document' && !isSavingTitle) {
                  setIsEditingTitle(true)
                  setEditTitle(title)
                }
              }}
              title={mode === 'document' ? 'Click to rename' : title}
              className={`
                text-slate-200 font-medium text-sm truncate max-w-xs
                ${mode === 'document' ? 'cursor-pointer hover:text-white' : 'cursor-default'}
              `}
            >
              {title}
            </span>
          )}
        </div>

        {/* Right side — Share, Export, and History buttons */}
        <div className="flex items-center gap-2">
          {mode === 'document' && (
            <div className="flex items-center gap-1 bg-slate-700/50 p-1 rounded-lg">
              <button
                onClick={() => setIsShareModalOpen(true)}
                className="
                  flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors
                  text-slate-300 hover:text-white hover:bg-slate-600
                "
              >
                <Share2 size={13} />
                <span>Share</span>
              </button>
              <div className="w-[1px] h-3 bg-slate-600 mx-0.5" />
              <button
                onClick={() => setShowShareLinks(!showShareLinks)}
                title="Manage active share links"
                className={`
                  flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors
                  ${showShareLinks
                    ? 'bg-indigo-500/20 text-indigo-400'
                    : 'text-slate-400 hover:text-white hover:bg-slate-600'}
                `}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </button>
            </div>
          )}

          {mode === 'document' && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => void handleToggleLock()}
                disabled={isLockLoading || isLockedByOther}
                title={isLockedByMe ? 'Click to unlock' : isLockedByOther ? 'Locked by another user' : 'Click to lock for exclusive editing'}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${isLockedByMe
                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                    : isLockedByOther
                      ? 'bg-red-500/10 text-red-400 cursor-not-allowed'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }
                `}
              >
                {isLockLoading
                  ? <Loader2 size={14} className="animate-spin" />
                  : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d={isLockedByMe
                          ? 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z'
                          : 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'}
                      />
                    </svg>
                  )
                }
                <span>
                  {isLockedByMe ? 'Unlock' : isLockedByOther ? 'Locked' : 'Lock'}
                </span>
              </button>

              {isLockedByOther && userRole === 'admin' && (
                <button
                  onClick={() => void handleForceUnlock()}
                  disabled={isLockLoading}
                  title="Force unlock (Admin only)"
                  className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m4 0v2m-2 5h.01M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H5a2 2 0 00-2 2v5a2 2 0 002 2z" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {mode === 'document' && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${showHistory
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'}
              `}
            >
              <History size={14} />
              <span>History</span>
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={isExporting || loadState !== 'connected'}
            title="Export as .docx"
            className="
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
            text-slate-400 hover:text-white hover:bg-slate-700
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors
          "
          >
            {isExporting
              ? <Loader2 size={14} className="animate-spin" />
              : <Download size={14} />
            }
            <span>{isExporting ? 'Exporting...' : 'Export .docx'}</span>
          </button>
        </div>
      </header>

      {/* ── Main Content Area ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex relative">
        <div className="flex-1 overflow-hidden">
          <CollaborativeEditor
            documentName={documentName}
            initialContent={initialContent}
            onReady={() => setLoadState('connected')}
            onEditorReady={(editor) => { editorRef.current = editor }}
            readOnly={isLockedByOther}
            currentUser={user!}
            teamId={teamId!}
          />
        </div>

        {/* Side Panels */}
        {showHistory && mode === 'document' && (
          <div className="w-80 border-l border-slate-700 bg-slate-850 flex-shrink-0 animate-in slide-in-from-right duration-200">
            <VersionHistoryPanel
              teamId={teamId!}
              docId={docId!}
              onClose={() => setShowHistory(false)}
            />
          </div>
        )}

        {showShareLinks && mode === 'document' && (
          <div className="w-80 border-l border-slate-700 bg-slate-850 flex-shrink-0 animate-in slide-in-from-right duration-200">
            <DocumentShareLinksPanel
              teamId={teamId!}
              docId={docId!}
              currentUserId={user!.id}
              userRole={userRole}
              onClose={() => setShowShareLinks(false)}
            />
          </div>
        )}
      </div>

      {/* ── Share Modal ───────────────────────────────────────────────────── */}
      {isShareModalOpen && mode === 'document' && docId && (
        <ShareLinkModal
          itemType="document"
          itemId={parseInt(docId, 10)}
          teamId={parseInt(teamId!, 10)}
          itemName={title}
          onClose={() => setIsShareModalOpen(false)}
        />
      )}
    </div>
  )
}
