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
import { ArrowLeft, FileText, Loader2, Download } from 'lucide-react'
import CollaborativeEditor, { DocumentName } from '@/components/editor/CollaborativeEditor'
import type { AxiosError } from 'axios'
import axios from 'axios'
import { useAuth } from '@/hooks/useAuth'
import { fetchDocument, renameDocument } from '@/api/documents'
import { exportToDocx } from '@/utils/exportDocx'
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
  // RENDER: Error state
  // --------------------------------------------------------------------------
  // Problem 6 fix: Show a clean error when the docId doesn't exist in the DB.
  // Without this, users would see a blank editor that silently loses all content.
  // --------------------------------------------------------------------------
  if (error) {
    return (
      <div className="h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <FileText className="w-8 h-8 text-red-400" />
          </div>
          <p className="text-slate-300 font-medium">{error}</p>
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

        {/* Right side — Export button (Addition 3) */}
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
      </header>

      {/* ── Collaborative Editor ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <CollaborativeEditor
          documentName={documentName}
          initialContent={initialContent}
          onReady={() => setLoadState('connected')}
          onEditorReady={(editor) => { editorRef.current = editor }}
          readOnly={false}
          currentUser={user!}
          teamId={teamId!}
        />
      </div>
    </div>
  )
}
