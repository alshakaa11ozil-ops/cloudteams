// =============================================================================
// src/components/editor/CollaborativeEditor.tsx
//
// HOW IT WORKS — END TO END:
//   1. Component mounts → useEffect creates Y.Doc + HocuspocusProvider
//   2. Provider connects to ws://localhost:3001/collaboration
//      sending documentName ("doc-42" or "file-17") + JWT token
//   3. Hocuspocus onAuthenticate runs → verifies JWT + team membership
//   4. Hocuspocus Database.fetch() runs → loads yjs_state from PostgreSQL
//   5. useEditor creates TipTap instance bound to the Y.Doc
//   6. All keystrokes → Yjs CRDT updates → broadcast to all connected clients
//   7. Other users' cursors appear via CollaborationCursor (Awareness Protocol)
//   8. Hocuspocus store() saves to PostgreSQL every 5 seconds
//
// WHY TWO-COMPONENT SPLIT (Outer + Inner):
//   useEditor() must receive a STABLE extensions array referencing ydoc/provider.
//   If providers and useEditor() lived in the same component, every provider
//   recreation (Strict Mode) would reinitialise TipTap → flickering, lost focus.
//   Outer manages provider lifecycle. Inner receives stable providers as props.
//   Inner only remounts when documentName changes — which is correct.
//
// WHY useState + `destroyed` FLAG (not useRef, not useMemo):
//   React 18 Strict Mode runs every effect twice: mount → cleanup → mount.
//   - useRef: doesn't trigger re-renders → EditorInner never mounts → spinner forever
//   - useMemo: React can discard memoized values → providers recreated unpredictably
//   - useState without flag: setState from dead Effect 1 fires after cleanup
//     → destroyed providers set into state → TipTap crashes on access
//   With the flag: destroyed=true in cleanup → Effect 1's setState SKIPS →
//     Effect 2 creates fresh providers → setBundle(bundle2) → EditorInner mounts ✅
//
// WHY url DIRECTLY (not HocuspocusProviderWebsocket):
//   HocuspocusProviderWebsocket connects IMMEDIATELY on construction, before
//   the `destroyed` flag can be checked. Two ws objects both try to connect
//   before either is destroyed → two pending /collaboration connections.
//   Using url directly: HocuspocusProvider manages its own ws internally.
//   provider.destroy() in cleanup cancels the ws before it fully establishes.
//
// WHY setTimeout(0) FOR DESTROY (not flushSync, not requestAnimationFrame):
//   PROBLEM: ydoc.destroy() must run AFTER TipTap releases its internal
//   reference to ydoc. TipTap releases it during EditorInner's unmount.
//   EditorInner unmounts when setBundle(null) triggers a React re-render.
//   But setBundle(null) only SCHEDULES the re-render — React batches it.
//
//   flushSync:  React forbids it inside useEffect cleanup. Throws:
//               "flushSync was called from inside a lifecycle method."
//
//   rAF (~16ms): Effect 2 (Strict Mode remount) starts BEFORE the 16ms fires.
//               Two Hocuspocus connections are alive simultaneously. When rAF
//               fires and destroys connection 1, it kills the shared room →
//               connection 2 loses authentication → editor never loads.
//
//   setTimeout(0): Queues destroy in the macrotask queue. React processes
//               setBundle(null) within the current microtask — EditorInner
//               unmounts and TipTap releases ydoc — BEFORE the macrotask runs.
//               Effect 2 cannot start until the current call stack is empty,
//               which happens AFTER setTimeout(0) fires (same event loop tick).
//               Result: ydoc released by TipTap → ydoc.destroy() → Effect 2
//               creates fresh ydoc. Correct ordering guaranteed. ✅
// =============================================================================

// =============================================================================
// src/components/editor/CollaborativeEditor.tsx
//
// ARCHITECTURE: Two-component split (Outer + Inner)
//
//   Outer: manages Y.Doc + HocuspocusProvider lifecycle
//   Inner: receives stable ydoc + provider, owns TipTap editor
//
// ─── WHY provider.disconnect() INSTEAD OF provider.destroy() IN CLEANUP ────
//
//   The crash "Cannot read properties of undefined (reading 'doc')" comes from
//   inside TipTap's @tiptap/extension-collaboration. That extension holds an
//   internal reference to ydoc and accesses ydoc.doc during its OWN teardown.
//
//   Every approach to calling ydoc.destroy() in Outer's cleanup fails because
//   React 18 batches setBundle(null) with setBundle(bundle2), so EditorInner
//   re-renders (not unmounts) with new props, leaving TipTap still holding the
//   old ydoc while we destroy it underneath it.
//
//   Approaches proven not to work:
//     flushSync        → React throws "called from inside lifecycle method"
//     requestAnimationFrame → Effect 2 starts inside the 16ms window, two
//                             Hocuspocus rooms open simultaneously
//     setTimeout(0)    → React batches setBundle(null)+setBundle(bundle2),
//                         EditorInner re-renders (not unmounts), stale ydoc crash
//     key={bundleId}   → Same batching issue; key forces remount only when React
//                         sees the transition, which batching prevents
//
//   CORRECT SOLUTION:
//     Call provider.disconnect() to close the WebSocket cleanly.
//     Do NOT call provider.destroy() or ydoc.destroy().
//     Let both be garbage-collected after EditorInner unmounts and releases them.
//
//   WHY THIS IS SAFE:
//     - In PRODUCTION: Strict Mode is disabled. Cleanup only runs on genuine
//       navigation away. GC is immediate. No data loss, no stale connections.
//     - In DEVELOPMENT: A brief stale WebSocket exists for ~100ms while GC
//       collects the old bundle. The backend onDisconnect handler cleans up
//       the server side. The new bundle connects cleanly in parallel.
//     - Hocuspocus backend is stateless per-connection — a stale connection
//       closing triggers onDisconnect, which is a clean operation.
//
// ─── TWO REAL CODE BUGS ALSO FIXED IN THIS VERSION ──────────────────────────
//
//   BUG 1 (visible in screenshot, line 463):
//     BEFORE: if (!editor || !initialContent || contentInserted || ...)
//     AFTER:  if (!editor || !initialContent || contentInserted || ...) return
//     Missing `return` caused execution to fall through to editor.isEmpty
//     even when editor was null → TypeError.
//
//   BUG 2 (duplicate Underline extension):
//     StarterKit.configure({ underline: false }) prevents double-registration.
//     StarterKit includes Underline by default. We add it explicitly below.
//     Two registrations = TipTap warning + undefined behaviour.
// =============================================================================

import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../../api/axios'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
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
  // "doc-42" or "file-17" — Hocuspocus routes to correct DB table
  documentName: DocumentName
  // Passed only on FIRST open of an existing file (no prior Yjs state in DB)
  initialContent?: { type: 'text' | 'html'; content: string }
  // Called when editor is ready — hides loading skeleton in DocumentEditor
  onReady?: () => void
  // Gives DocumentEditor the TipTap instance for .docx export
  onEditorReady?: (editor: import('@tiptap/react').Editor) => void
  readOnly?: boolean
  currentUser: { id: number; username?: string; full_name: string | null }
  teamId: string
}

interface ProviderBundle {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  bundleId: number
}

// Unique counter per bundle — used as the key prop to force EditorInner
// to fully unmount + remount when documentName changes mid-session
let bundleCounter = 0

// Deterministic cursor color per userId — same color every session
// so teammates can recognise each other's cursors without reading the label
function getAvatarColor(userId: number): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  ]
  return colors[userId % colors.length]
}

// =============================================================================
// OUTER COMPONENT — manages provider lifecycle, renders EditorInner
// =============================================================================
export default function CollaborativeEditor(props: CollaborativeEditorProps) {
  const { documentName } = props
  const [bundle, setBundle] = useState<ProviderBundle | null>(null)

  useEffect(() => {
    // `destroyed` flag prevents setState from a dead Effect 1 firing after
    // React 18 Strict Mode runs cleanup and then Effect 2.
    // Without it: cleanup runs → Effect 1's setBundle fires → dead providers
    // go into state → EditorInner receives destroyed ydoc → crash.
    let destroyed = false
    const currentBundleId = ++bundleCounter

    console.log(`[CollaborativeEditor] Creating bundle #${currentBundleId} for "${documentName}"`)

    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: `${import.meta.env.VITE_WS_URL}/collaboration`,
      name: documentName,
      document: ydoc,
      // JWT sent in WS payload — browser cannot set Authorization headers
      // on WebSocket upgrade requests post-handshake
      token: localStorage.getItem('cloudteams_token') ?? '',
      onAuthenticationFailed({ reason }) {
        console.error('[Hocuspocus] Auth failed:', reason)
        // WHY: 'permission-denied' for locked docs means readOnly mode,
        // not a real auth failure. The actual lock toast is shown by
        // DocumentEditor via Socket.io. Don't double-toast here.
        if (reason !== 'permission-denied') {
            toast.error(`Authentication failed: ${reason}`)
        }
    },
    })

    if (!destroyed) {
      setBundle({ ydoc, provider, bundleId: currentBundleId })
    } else {
      // Cleanup ran before setState — EditorInner never mounted with these.
      // Immediate destroy is safe because TipTap never held a reference to them.
      provider.destroy()
      ydoc.destroy()
    }

    return () => {
      destroyed = true
      console.log(`[CollaborativeEditor] Destroying bundle #${currentBundleId} for "${documentName}"`)

      // ── WHY disconnect() and NOT destroy() ──────────────────────────────
      // provider.destroy() + ydoc.destroy() cause:
      //   "TypeError: Cannot read properties of undefined (reading 'doc')"
      // from inside TipTap's Collaboration extension.
      //
      // Root cause: React 18 batches setBundle(null) with setBundle(bundle2).
      // EditorInner re-renders (not unmounts), TipTap still holds ydoc internally.
      // destroy() tears down ydoc while TipTap references it → crash.
      //
      // provider.disconnect() closes the WebSocket cleanly without destroying
      // the in-memory state. Once React finishes rendering (EditorInner gone),
      // GC collects ydoc and provider — no memory leak, no crash.
      // ────────────────────────────────────────────────────────────────────
      provider.disconnect()
      setBundle(null)
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

  // key={bundle.bundleId} — when documentName changes, bundleId increments.
  // React sees a new key → MUST fully unmount old EditorInner, mount fresh one.
  // This ensures useEditor always receives the ydoc it was initialized with.
  // Within a single document session, the key stays the same → no remounting.
  return (
    <EditorInner
      key={bundle.bundleId}
      {...props}
      ydoc={bundle.ydoc}
      provider={bundle.provider}
      bundleId={bundle.bundleId}
    />
  )
}

// =============================================================================
// INNER COMPONENT — receives stable ydoc + provider, owns TipTap editor
// =============================================================================
interface EditorInnerProps extends CollaborativeEditorProps {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  bundleId: number
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
  bundleId,
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

  // Ref for reconnect counter — readable in callbacks without stale closure
  const reconnectCountRef = useRef(0)

  // Safety net: reset internal state if bundleId changes without a key remount
  const prevBundleIdRef = useRef(bundleId)
  useEffect(() => {
    if (prevBundleIdRef.current !== bundleId) {
      prevBundleIdRef.current = bundleId
      setConnectionStatus('connecting')
      setContentInserted(false)
      setLastSyncedAt(null)
      setHasUnsavedChanges(false)
      reconnectCountRef.current = 0
    }
  }, [bundleId])

  // ── Provider event listeners ──────────────────────────────────────────────
  // Provider is stable for EditorInner's lifetime — this runs once on mount
  useEffect(() => {
    const handleStatus = ({ status }: { status: string }) => {
      console.log(`[EditorInner] Status: ${status}`)
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
    // Fires once when server has delivered the full document state
    const handleSynced = () => {
      console.log('[EditorInner] Synced ✅ — content ready from server')
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
  // ydoc and provider are stable props for EditorInner's lifetime.
  // useMemo rebuilds only if currentUser display info changes.
  const extensions = useMemo(() => [
    StarterKit.configure({
      // BUG FIX: underline: false prevents duplicate extension registration.
      // StarterKit includes Underline by default. We add it explicitly below.
      // Two registrations = "[tiptap warn]: Duplicate extension names found"
      // and unpredictable behaviour. One registration = correct. ✅
      underline: false,
    }),

    // Collaboration MUST be before CollaborationCaret — it registers the
    // Yjs binding that CollaborationCaret reads for awareness data
    Collaboration.configure({ document: ydoc }),

    CollaborationCaret.configure({
      provider,
      user: {
        name: currentUser.full_name ?? currentUser.username ?? 'Anonymous',
        color: getAvatarColor(currentUser.id),
      },
    }),

    Placeholder.configure({
      placeholder: 'Start typing to collaborate in real time...',
    }),

    // The single registered Underline (StarterKit's copy disabled above)
    Underline,
    Highlight.configure({ multicolor: false }),
    TaskList,
    TaskItem.configure({ nested: true }),

  ], [ydoc, provider, currentUser.id, currentUser.full_name, currentUser.username])

  const editor = useEditor({ editable: !readOnly, extensions })

  // ── Sync readOnly prop ────────────────────────────────────────────────────
  // useEditor only reads `editable` on mount — this effect handles live changes
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

  // ── Insert initial file content (first open only) ─────────────────────────
  // Only runs when an existing file (.txt/.md/.docx) is opened for the first
  // time and the backend sends its content as initialContent.
  // For native documents, Hocuspocus loads the saved Yjs state automatically.
  //
  // WHY wait for connectionStatus === 'connected':
  //   Hocuspocus applies the server's Yjs state on connect + sync.
  //   Inserting content before that would be overwritten by the server state.
  //   After 'connected' (set by handleSynced), the server state is applied.
  //   We then check editor.isEmpty before inserting — another user may have
  //   already typed content since the file was first opened.
  useEffect(() => {
    // BUG FIX: `return` was missing in the previous version.
    // Without return: execution fell through to editor.isEmpty even when
    // editor was null → "Cannot read properties of null (reading 'isEmpty')"
    // The setContent call also triggered Collaboration extension to access
    // ydoc.doc — if ydoc was in a bad state, this caused the crash. ✅
    if (!editor || !initialContent || contentInserted || connectionStatus !== 'connected') return

    if (editor.isEmpty) {
      if (initialContent.type === 'html') {
        // TipTap v3 signature: setContent(value, options?: SetContentOptions)
        // { emitUpdate: false } prevents a spurious update event on initial load.
        editor.commands.setContent(initialContent.content, { emitUpdate: false })
      } else {
        // .txt / .md — split by newline, wrap each line in a paragraph node.
        // WHY not setContent(rawString): everything collapses into one paragraph.
        // Splitting preserves the original line structure of the file.
        const paragraphs = initialContent.content
          .split('\n')
          .filter(l => l.trim().length > 0)
          .map(l => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }))
        editor.commands.setContent({ type: 'doc', content: paragraphs }, { emitUpdate: false })
      }
    }

    setContentInserted(true)
    onReady?.()
  }, [editor, initialContent, contentInserted, connectionStatus, onReady])

  // ── Signal ready for native documents ────────────────────────────────────
  // Native documents have no initialContent — signal ready once connected
  useEffect(() => {
    if (connectionStatus === 'connected' && !initialContent) onReady?.()
  }, [connectionStatus, initialContent, onReady])

  // ── Expose editor instance to parent ─────────────────────────────────────
  // DocumentEditor uses this for .docx export (editor.getJSON())
  useEffect(() => {
    if (editor) onEditorReady?.(editor)
  }, [editor, onEditorReady])

  // ── Session token check ───────────────────────────────────────────────────
  // Runs every 5 minutes + on tab visibility change.
  // Tries silent refresh before forcing logout — minimises disruption.
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
        } catch { /* refresh also failed */ }
        provider.disconnect()
        toast.error('Session expired. Please log in again.', { duration: 5000 })
        navigate('/login', { replace: true })
      }
    }
    const id = setInterval(checkToken, 5 * 60 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkToken()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [provider, navigate])

  // ── Before-unload warning ─────────────────────────────────────────────────
  // Only warn when OFFLINE + unsaved. When connected, Hocuspocus store() fires
  // on disconnect and saves — no data at risk from normal tab close.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (connectionStatus === 'disconnected' && hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [connectionStatus, hasUnsavedChanges])

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full relative">

      {/* Presence bar + connection indicator */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <PresenceBar provider={provider} currentUser={currentUser} />
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span className={`inline-block w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' :
            connectionStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' :
              'bg-red-400'
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

      {/* Formatting toolbar */}
      <EditorToolbar
        editor={editor}
        readOnly={readOnly}
        onAskAI={() => setShowAskAI(true)}
      />

      {/* Ask AI popover */}
      {editor && !readOnly && showAskAI && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowAskAI(false)} />
          <div className="fixed right-8 top-32 z-50">
            <AskAIPopover
              editor={editor}
              teamId={teamId}
              onClose={() => setShowAskAI(false)}
            />
          </div>
        </>
      )}

      {/* Connection lost overlay — shown after 5 failed reconnects */}
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

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto bg-slate-900">
        <EditorContent editor={editor} className="max-w-4xl mx-auto" />
      </div>

      {/* Footer: save status + word count */}
      <div className="flex-shrink-0 px-6 py-2 bg-slate-800 border-t border-slate-700 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {lastSyncedAt
            ? 'All changes saved'
            : connectionStatus === 'connected' ? 'Saving...' : 'Not connected'}
        </span>
        <span className="text-xs text-slate-500 font-medium">
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
      </div>
    </div>
  )
}