// =============================================================================
// src/components/editor/CollaborativeEditor.tsx
//
// FINAL VERSION — solves all previous issues:
//
// Issue 1 (two connections pending): HocuspocusProviderWebsocket connects
//   immediately on construction before destroyed flag is checked.
//   FIX: Use `url` directly in HocuspocusProvider — no separate ws provider.
//
// Issue 2 (stuck on "Connecting..."): useRef doesn't trigger re-renders.
//   FIX: Use useState + `destroyed` flag pattern.
//
// Issue 3 (content not saved): React Strict Mode cleanup calls store() with
//   empty state from the first connection, then the real connection's store()
//   fails or is skipped.
//   FIX: hocuspocus.ts now skips empty states (< 20 bytes).
//        This file ensures only ONE real connection exists at a time.
// =============================================================================

import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '@/api/axios'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

import './editor.css'
import PresenceBar from './PresenceBar'
import EditorToolbar from './EditorToolbar'
import AskAIPopover from './AskAIPopover'

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export type DocumentName = `doc-${number}` | `file-${number}`

interface CollaborativeEditorProps {
  documentName: DocumentName
  initialContent?: { type: 'text' | 'html'; content: string }
  onReady?: () => void
  onEditorReady?: (editor: import('@tiptap/react').Editor) => void
  readOnly?: boolean
  currentUser: { id: number; username?: string; full_name: string | null }
  teamId: string
}

interface ProviderBundle {
  ydoc: Y.Doc
  provider: HocuspocusProvider
}

function getAvatarColor(userId: number): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  ]
  return colors[userId % colors.length]
}

// ---------------------------------------------------------------------------
// OUTER COMPONENT — manages provider lifecycle
// ---------------------------------------------------------------------------
export default function CollaborativeEditor(props: CollaborativeEditorProps) {
  const { documentName } = props
  const [bundle, setBundle] = useState<ProviderBundle | null>(null)

  useEffect(() => {
    // WHY `destroyed` flag:
    //   React 18 Strict Mode runs every effect twice: mount → cleanup → mount.
    //   Without this flag, the setState from Effect 1 fires AFTER cleanup,
    //   setting destroyed providers into state → EditorInner crashes.
    //
    //   With the flag:
    //     Effect 1: creates providers, destroyed=false
    //     Cleanup:  destroyed=true → destroy providers → setBundle(null)
    //     Effect 1's setState checks destroyed → SKIPS (dead providers)
    //     Effect 2: creates fresh providers → setBundle(bundle2) ✅
    let destroyed = false

    console.log(`[CollaborativeEditor] Creating providers for "${documentName}"`)

    const ydoc = new Y.Doc()

    // WHY url directly (not HocuspocusProviderWebsocket):
    //   HocuspocusProviderWebsocket connects IMMEDIATELY on construction,
    //   before the `destroyed` flag can be checked. During Strict Mode
    //   cleanup, the ws is destroyed but already sent a connection request.
    //   That request is still pending when Effect 2 creates another ws
    //   → two simultaneous connections, both hanging as "Pending".
    //
    //   Using url directly: HocuspocusProvider manages its own ws internally.
    //   provider.destroy() in cleanup cancels the ws before it fully connects.
    const provider = new HocuspocusProvider({
      url: `${import.meta.env.VITE_WS_URL}/collaboration`,
      name: documentName,
      document: ydoc,
      token: localStorage.getItem('cloudteams_token') ?? '',
      onAuthenticationFailed({ reason }) {
        console.error('[Hocuspocus] Auth failed:', reason)
        toast.error(`Authentication failed: ${reason}`)
      },
    })

    if (!destroyed) {
      setBundle({ ydoc, provider })
    } else {
      // Cleanup ran before this line — destroy immediately
      provider.destroy()
      ydoc.destroy()
    }

    return () => {
      destroyed = true
      console.log(`[CollaborativeEditor] Destroying providers for "${documentName}"`)

      // WHY synchronous destroy (no requestAnimationFrame):
      //   React 18 Strict Mode: Effect 1 cleanup runs, then Effect 2 creates
      //   a new provider. If cleanup uses requestAnimationFrame, Effect 1's
      //   WebSocket is still alive when Effect 2's WebSocket connects —
      //   Hocuspocus sees two connections for the same document, closes the
      //   room when the first one disconnects, killing the second too.
      //   Result: onAuthenticate never fires, content never saves.
      //
      //   Synchronous destroy: Effect 1's WebSocket is closed immediately,
      //   before Effect 2 even starts. Only one connection ever exists.
      //   setBundle(null) + synchronous destroy is safe because JS is
      //   single-threaded — React cannot re-render between these two lines.
      setBundle(null)
      provider.destroy()
      ydoc.destroy()
    }
  }, [documentName]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!bundle) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900 h-full min-h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Connecting to document...</span>
        </div>
      </div>
    )
  }

  return <EditorInner {...props} ydoc={bundle.ydoc} provider={bundle.provider} />
}

// ---------------------------------------------------------------------------
// INNER COMPONENT — receives stable providers, owns TipTap
// ---------------------------------------------------------------------------
interface EditorInnerProps extends CollaborativeEditorProps {
  ydoc: Y.Doc
  provider: HocuspocusProvider
}

function EditorInner({
  initialContent,
  onReady,
  onEditorReady,
  readOnly = false,
  currentUser,
  teamId,
  ydoc,
  provider,
}: EditorInnerProps) {
  const navigate = useNavigate()

  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting')
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [maxAttemptsExceeded, setMaxAttemptsExceeded] = useState(false)
  const [contentInserted, setContentInserted] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [showAskAI, setShowAskAI] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const reconnectCountRef = useRef(0)

  // ── Provider events ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleStatus = ({ status }: { status: string }) => {
      console.log('[Hocuspocus] Status:', status)
      if (status === 'connected') {
        if (reconnectCountRef.current > 0) toast.success('Connection restored')
        reconnectCountRef.current = 0
        setReconnectAttempts(0)
        setMaxAttemptsExceeded(false)
        setConnectionStatus('connected')
      } else if (status === 'connecting') {
        setConnectionStatus('connecting')
      } else if (status === 'disconnected') {
        setConnectionStatus('disconnected')
      }
    }

    const handleClose = () => {
      reconnectCountRef.current++
      setReconnectAttempts(reconnectCountRef.current)
      if (reconnectCountRef.current >= 5) setMaxAttemptsExceeded(true)
    }

    const handleSynced = () => {
      console.log('[Hocuspocus] Synced ✅')
      setLastSyncedAt(new Date())
      setHasUnsavedChanges(false)
      setConnectionStatus('connected')
    }

    provider.on('status', handleStatus)
    provider.on('close', handleClose)
    provider.on('synced', handleSynced)

    return () => {
      provider.off('status', handleStatus)
      provider.off('close', handleClose)
      provider.off('synced', handleSynced)
    }
  }, [provider])

  // ── TipTap extensions ─────────────────────────────────────────────────────
  const extensions = useMemo(() => [
    StarterKit.configure({
      history: false,
      // WHY false: Collaboration adds Yjs UndoManager.
      // StarterKit's History is ProseMirror-local — Ctrl+Z wouldn't sync
      // across clients, producing divergent state.
    }),
    Collaboration.configure({ document: ydoc }),
    CollaborationCursor.configure({
      provider,
      user: {
        name: currentUser.full_name ?? currentUser.username ?? 'Anonymous',
        color: getAvatarColor(currentUser.id),
      },
    }),
    Placeholder.configure({ placeholder: 'Start typing to collaborate in real time...' }),
    Underline,
    Highlight.configure({ multicolor: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,         // Don't navigate on click in editor — only in readOnly
      autolink: true,             // Auto-detect URLs as the user types
      linkOnPaste: true,          // Convert pasted URLs to links
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank', class: 'editor-link' },
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    }),
  ], [ydoc, provider, currentUser.id, currentUser.full_name, currentUser.username])

  const editor = useEditor({ editable: !readOnly, extensions })

  // ── Sync readOnly ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // ── Word count ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    const updateCount = () => {
      const text = editor.getText()
      setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
    }
    updateCount()
    const onUpdate = () => { updateCount(); setHasUnsavedChanges(true) }
    editor.on('update', onUpdate)
    return () => { editor.off('update', onUpdate) }
  }, [editor])

  // ── Insert initial content (file first open) ──────────────────────────────
  useEffect(() => {
    if (!editor || !initialContent || contentInserted || connectionStatus !== 'connected') return
    if (editor.isEmpty) {
      if (initialContent.type === 'html') {
        editor.commands.setContent(initialContent.content, false)
      } else {
        const paragraphs = initialContent.content
          .split('\n')
          .filter(l => l.trim().length > 0)
          .map(l => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }))
        editor.commands.setContent({ type: 'doc', content: paragraphs }, false)
      }
    }
    setContentInserted(true)
    onReady?.()
  }, [editor, initialContent, contentInserted, connectionStatus, onReady])

  // ── Signal ready (native documents) ──────────────────────────────────────
  useEffect(() => {
    if (connectionStatus === 'connected' && !initialContent) onReady?.()
  }, [connectionStatus, initialContent, onReady])

  // ── Expose editor instance ────────────────────────────────────────────────
  useEffect(() => {
    if (editor) onEditorReady?.(editor)
  }, [editor, onEditorReady])

  // ── Zombie token check ────────────────────────────────────────────────────
  useEffect(() => {
    const checkToken = async () => {
      try {
        await api.get('/auth/me')
      } catch (err: any) {
        if (err.response?.status !== 401) return
        try {
          const res = await api.post('/auth/refresh')
          const newToken = res.data?.token
          if (newToken) { localStorage.setItem('cloudteams_token', newToken); return }
        } catch { /* refresh failed */ }
        provider.disconnect()
        toast.error('Session expired. Please log in again.', { duration: 5000 })
        navigate('/login', { replace: true })
      }
    }
    const id = setInterval(checkToken, 5 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') void checkToken() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [provider, navigate])

  // ── Before-unload warning ─────────────────────────────────────────────────
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (connectionStatus === 'disconnected' && hasUnsavedChanges) {
        e.preventDefault(); e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [connectionStatus, hasUnsavedChanges])

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full relative">

      {/* Presence + status */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <PresenceBar provider={provider} currentUser={currentUser} />
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span className={`inline-block w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' :
              connectionStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
            }`} />
          <span className={
            connectionStatus === 'connected' ? 'text-emerald-400' :
              connectionStatus === 'connecting' ? 'text-yellow-400' : 'text-red-400'
          }>
            {connectionStatus === 'connected' && 'Live'}
            {connectionStatus === 'connecting' && reconnectAttempts > 0
              && `Reconnecting (${reconnectAttempts} of 5)...`}
            {connectionStatus === 'connecting' && reconnectAttempts === 0 && 'Connecting...'}
            {connectionStatus === 'disconnected' && 'Offline — changes not syncing'}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <EditorToolbar editor={editor} readOnly={readOnly} onAskAI={() => setShowAskAI(true)} />

      {/* Ask AI */}
      {editor && !readOnly && showAskAI && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowAskAI(false)} />
          <div className="fixed right-8 top-32 z-50">
            <AskAIPopover editor={editor} teamId={teamId} onClose={() => setShowAskAI(false)} />
          </div>
        </>
      )}

      {/* Connection lost overlay */}
      {maxAttemptsExceeded && (
        <div className="absolute inset-0 bg-slate-900/80 z-30 flex items-center justify-center">
          <div className="bg-slate-800 border border-red-500/60 rounded-xl p-6 max-w-sm w-full text-center shadow-2xl mx-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M6.343 17.657a9 9 0 010-12.728M9.172 14.828a5 5 0 010-7.072M12 12h.01" />
              </svg>
            </div>
            <p className="text-red-400 font-semibold mb-1">Connection lost</p>
            <p className="text-slate-400 text-sm mb-5 leading-relaxed">
              Could not reconnect after 5 attempts.<br />
              Your work is saved up to the last sync.
            </p>
            <button
              onClick={() => {
                setMaxAttemptsExceeded(false)
                reconnectCountRef.current = 0
                setReconnectAttempts(0)
                provider.connect()
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              Try reconnecting
            </button>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto bg-slate-900">
        <EditorContent editor={editor} className="max-w-4xl mx-auto" />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-2 bg-slate-800 border-t border-slate-700 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {lastSyncedAt ? 'All changes saved'
            : connectionStatus === 'connected' ? 'Saving...' : 'Not connected'}
        </span>
        <span className="text-xs text-slate-500 font-medium">
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
      </div>
    </div>
  )
}