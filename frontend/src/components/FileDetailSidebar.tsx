// =============================================================================
// src/components/FileDetailSidebar.tsx
//
// CHANGES IN THIS VERSION:
//   1. Preview uses fetchFilePreviewBlob — authenticated blob fetch eliminates 404s
//   2. Images use <img src={blobUrl}> — more reliable than iframe
//   3. PDFs use <iframe src={blobUrl}> — blob URL needs no auth header
//   4. Text/code files preview via HTML conversion (backend returns <pre> wrapped HTML)
//   5. lockToken persisted in sessionStorage — survives page refresh
//   6. Admin force-unlock button visible in Lock tab when userRole === 'admin'
//   7. Comment edit/delete with hover reveal
//   8. blobUrl revoked in useEffect cleanup — no memory leaks
// =============================================================================

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import DOMPurify from 'dompurify'
import socket from '../api/socket'
import { SOCKET_EVENTS } from '../socketEvents'
import {
  fetchLockStatus, fetchComments, addComment, editComment, deleteComment,
  fetchVersions, restoreVersion, fetchFilePreviewBlob, lockFile,
  unlockFile, forceUnlockFile, fetchFileSummary, saveFileVersion,
} from '../api/files'
import { fetchFileShares, revokeShareLink } from '../api/shares'
import type { CloudFile, Comment, FileVersion, LockStatus, TeamRole } from '../types'
import type { SharedLink } from '../api/shares'
import type { PreviewResult } from '../api/files'

// ─── Props ───────────────────────────────────────────────────────────────────

interface FileDetailSidebarProps {
  file: CloudFile | null
  teamId: number
  currentUserId: number
  userRole: TeamRole          // ← NEW: needed to show admin force-unlock button
  onShare: () => void
  onClose: () => void
}

type Tab = 'preview' | 'comments' | 'versions' | 'lock' | 'sharing'

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// sessionStorage key — per file so multiple tabs work independently
function lockKey(fileId: number) { return `cloudteams_lock_${fileId}` }

// Which file types need blob streaming (PDF, images)
function needsBlobStream(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/')
}

// Which file types get converted to HTML by the backend
function needsConversion(mimeType: string, filename: string): boolean {
  if (mimeType.includes('word')) return true
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return true
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return true
  if (mimeType.startsWith('text/')) return true
  if (['application/json', 'application/javascript', 'application/xml'].includes(mimeType)) return true
  // Extension fallback — browser sometimes sends wrong mime type for code files
  const codeExts = ['.txt', '.md', '.csv', '.js', '.ts', '.jsx', '.tsx',
    '.py', '.java', '.json', '.xml', '.html', '.css', '.sql', '.sh', '.yaml', '.yml', '.env']
  return codeExts.some(ext => filename.toLowerCase().endsWith(ext))
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function FileDetailSidebar({
  file, teamId, currentUserId, userRole, onShare, onClose,
}: FileDetailSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>('preview')
  const [newComment, setNewComment] = useState('')
  const [isAcquiring, setIsAcquiring] = useState(false)
  const [isForcing, setIsForcing] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // ── Preview state ─────────────────────────────────────────────────────────
  // previewResult holds the result of the authenticated blob/HTML fetch
  // null = not yet fetched, undefined = fetch in progress
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  // Track current blob URL so we can revoke it before creating a new one
  const blobUrlRef = useRef<string | null>(null)

  // ── Lock token: read from sessionStorage on mount / file change ───────────
  const [lockToken, setLockToken] = useState<string | null>(() =>
    file ? sessionStorage.getItem(lockKey(file.id)) : null
  )
  useEffect(() => {
    if (!file) { setLockToken(null); return }
    setLockToken(sessionStorage.getItem(lockKey(file.id)))
  }, [file?.id])

  // ── Fetch preview when tab becomes active or file changes ─────────────────
  // WHY useEffect not useQuery: the blob URL lifecycle (create + revoke) needs
  // imperative cleanup that useQuery's declarative model doesn't support cleanly.
  useEffect(() => {
    if (!file || activeTab !== 'preview') return

    // Nothing to preview for unsupported types
    if (!needsBlobStream(file.mime_type) && !needsConversion(file.mime_type, file.original_name)) {
      setPreviewResult({ type: 'unsupported' })
      return
    }

    let cancelled = false // prevents state update if file changes mid-fetch

    const loadPreview = async () => {
      setPreviewLoading(true)
      setPreviewResult(null)

      // Revoke previous blob URL before creating a new one — prevents memory leak
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }

      try {
        const result = await fetchFilePreviewBlob(
          file.id, teamId, file.mime_type
        )
        if (cancelled) return

        // Store blob URL in ref so cleanup can revoke it
        if (result.type === 'stream') {
          blobUrlRef.current = result.blobUrl
        }
        setPreviewResult(result)
      } catch {
        if (!cancelled) setPreviewResult({ type: 'unsupported' })
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    void loadPreview()

    // Cleanup: cancel in-flight fetch result AND revoke blob URL
    return () => {
      cancelled = true
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [file?.id, file?.updated_at, file?.mime_type, activeTab, teamId])

  // ── Listen to socket events for auto-refresh ───────────────────────────────
  useEffect(() => {
    if (!socket || !teamId || !file?.id) return

    const invalidateLock = (payload: any) => {
      if (payload.fileId === file.id) {
        void queryClient.invalidateQueries({ queryKey: ['lock-status', teamId, file.id] })
        void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
      }
    }

    const invalidateVersions = (payload: any) => {
      if (payload.fileId === file.id) {
        void queryClient.invalidateQueries({ queryKey: ['versions', teamId, file.id] })
      }
    }

    socket.on(SOCKET_EVENTS.FILE_LOCKED, invalidateLock)
    socket.on(SOCKET_EVENTS.FILE_UNLOCKED, invalidateLock)
    socket.on(SOCKET_EVENTS.FILE_VERSION_CREATED, invalidateVersions)

    return () => {
      socket.off(SOCKET_EVENTS.FILE_LOCKED, invalidateLock)
      socket.off(SOCKET_EVENTS.FILE_UNLOCKED, invalidateLock)
      socket.off(SOCKET_EVENTS.FILE_VERSION_CREATED, invalidateVersions)
    }
  }, [socket, teamId, file?.id, queryClient])

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: lockStatus } = useQuery<LockStatus>({
    queryKey: ['lock-status', teamId, file?.id],
    queryFn: () => fetchLockStatus(teamId, file!.id),
    enabled: !!file,
    refetchInterval: 10_000,
  })

  const { data: comments, isLoading: commentsLoading } = useQuery<Comment[]>({
    queryKey: ['comments', teamId, file?.id],
    queryFn: () => fetchComments(teamId, file!.id),
    enabled: !!file && activeTab === 'comments',
  })

  const { data: rawVersions, isLoading: versionsLoading } = useQuery<FileVersion[]>({
    queryKey: ['versions', teamId, file?.id],
    queryFn: () => fetchVersions(teamId, file!.id),
    enabled: !!file && activeTab === 'versions',
  })

  // Fetch active share links
  const { data: shares, isLoading: sharesLoading } = useQuery<SharedLink[]>({
    queryKey: ['shares', teamId, file?.id],
    queryFn: () => fetchFileShares(file!.id, teamId),
    enabled: !!file && activeTab === 'sharing',
  })

  // Sort descending — idx 0 is always the latest version
  const versions = [...(rawVersions ?? [])].sort((a, b) => b.version_number - a.version_number)

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => addComment(teamId, file!.id, content),
    onSuccess: () => {
      setNewComment('')
      void queryClient.invalidateQueries({ queryKey: ['comments', teamId, file?.id] })
      toast.success('Comment posted')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to post comment')
    }
  })

  const restoreVersionMutation = useMutation({
    mutationFn: (versionNumber: number) => restoreVersion(teamId, file!.id, versionNumber),
    onSuccess: () => {
      // 1. Invalidate queries to get fresh metadata
      void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['versions', teamId, file?.id] })
      // 2. CLEAR the current preview result so it's forced to re-fetch/re-blob the RESTORED content
      setPreviewResult(null)
      setPreviewLoading(true)
      // 3. Jump to preview tab to see the result
      setActiveTab('preview')
      toast.success('Version restored')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to restore version')
    }
  })

  const saveVersionMutation = useMutation({
    mutationFn: (versionName?: string) => saveFileVersion(teamId, file!.id, versionName),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['versions', teamId, file?.id] })
      toast.success(`Version ${data.version.version_number} saved`)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to save version')
    },
  })

  const revokeShareMutation = useMutation({
    mutationFn: (token: string) => revokeShareLink(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shares', teamId, file?.id] })
    }
  })

  // ── Lock handlers ─────────────────────────────────────────────────────────

  const invalidateLock = () =>
    void queryClient.invalidateQueries({ queryKey: ['lock-status', teamId, file?.id] })

  const handleStartEditing = async () => {
    if (!file) return
    setIsAcquiring(true)
    try {
      const result = await lockFile(teamId, file.id)
      setLockToken(result.lockToken)
      sessionStorage.setItem(lockKey(file.id), result.lockToken)
      toast.success('File locked')
      invalidateLock()
    } catch (err: any) {
      toast.error(err?.response?.status === 409
        ? 'This file is currently being edited by someone else.'
        : 'Could not acquire lock. Try again.')
    } finally {
      setIsAcquiring(false)
    }
  }


  const handleStopEditing = async () => {
    if (!file || !lockToken) return
    try {
      await unlockFile(teamId, file.id, lockToken)
      toast.success('File unlocked')
    } catch { /* expired — clear anyway */ } finally {
      setLockToken(null)
      sessionStorage.removeItem(lockKey(file.id))
      invalidateLock()
    }
  }

  // Admin force unlock — breaks ANY active lock
  const handleForceUnlock = async () => {
    if (!file) return
    if (!window.confirm('Force-release this lock? This will interrupt whoever is currently editing.')) return
    setIsForcing(true)
    try {
      await forceUnlockFile(teamId, file.id)
      toast.success('Lock force-released')
      invalidateLock()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Force unlock failed.')
    } finally {
      setIsForcing(false)
    }
  }



  // ── Conditional render AFTER all hooks ────────────────────────────────────
  if (!file) return null

  // Check if locked and ensure the lock has not expired yet (handles backend not verifying expiration)
  const isLocked = (lockStatus?.isLocked ?? false) && 
    (lockStatus?.lockExpiresAt 
        ? new Date(lockStatus.lockExpiresAt) > new Date() 
        : true)
  const isLockedByMe = lockStatus?.lockedBy?.id === currentUserId
  const isAdmin = userRole === 'admin'

  const EDITABLE_MIME_TYPES = [
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
  const isEditable = EDITABLE_MIME_TYPES.includes(file.mime_type ?? '')

  return (
    <div className="w-96 border-l bg-white flex flex-col h-full shadow-xl flex-shrink-0">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="p-4 border-b flex items-center justify-between bg-slate-50 flex-shrink-0">
        <div className="flex-1 min-w-0 mr-2">
          <h2 className="font-bold text-slate-800 truncate text-sm" title={file.original_name}>
            {file.original_name}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {formatBytes(file.file_size)} · {file.uploader.username} · {format(new Date(file.created_at), 'MMM d, yyyy')}
          </p>

          <div className="mt-2">
            {file.encryption_iv ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                AES-256 Encrypted
              </span>
            ) : (
              <span className="text-[10px] text-slate-300 italic uppercase">Not encrypted</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 1. Navigate to Edit Page (Indigo) */}
          {isEditable && !isLocked && (
            <button
              onClick={() => navigate(`/teams/${teamId}/files/${file.id}/edit`)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
          )}

          {/* 2. Manual Lock Toggle (Blue/Green) */}
          {!lockToken && !isLocked && (
            <button
              onClick={handleStartEditing}
              disabled={isAcquiring}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-200"
              title="Lock file"
            >
              {isAcquiring ? (
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          )}

          {lockToken && (
            <button
              onClick={handleStopEditing}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Unlock
            </button>
          )}

          {/* 3. Locked Status Badge (Amber) */}
          {isLocked && !lockToken && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 uppercase tracking-tight border border-amber-200">
              🔒 Locked
            </span>
          )}

          <div className="w-px h-4 bg-gray-200 mx-1" />

          <button
            onClick={onShare}
            className="p-1.5 hover:bg-indigo-100 text-indigo-600 rounded-full transition-colors"
            title="Share file"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-full transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex border-b text-sm px-2 flex-shrink-0">
        {(['preview', 'comments', 'versions', 'lock', 'sharing'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-3 font-medium capitalize border-b-2 transition-all ${activeTab === tab
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">

        {/* ════ PREVIEW TAB ════ */}
        {activeTab === 'preview' && (
          <div className="h-full flex flex-col" style={{ minHeight: 400 }}>

            {/* Loading spinner */}
            {previewLoading && (
              <div className="flex items-center justify-center flex-1">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            )}

            {/* PDF — blob URL in iframe (no auth needed — it's a local blob) */}
            {!previewLoading && previewResult?.type === 'stream' && previewResult.mimeType === 'application/pdf' && (
              <iframe
                src={previewResult.blobUrl}
                className="w-full flex-1 border-none"
                title={`Preview of ${file.original_name}`}
              // No sandbox needed — blob URLs are already same-origin
              // and don't make any server requests
              />
            )}

            {/* Images — blob URL in <img> (reliable, no sandbox issues) */}
            {!previewLoading && previewResult?.type === 'stream' && previewResult.mimeType.startsWith('image/') && (
              <div className="flex-1 flex items-center justify-center p-4 bg-slate-50">
                <img
                  src={previewResult.blobUrl}
                  alt={file.original_name}
                  className="max-w-full max-h-full object-contain rounded shadow-sm"
                />
              </div>
            )}

            {/* DOCX / XLSX / text / code — HTML from backend, sanitized */}
            {!previewLoading && previewResult?.type === 'html' && (
              <div
                className="prose prose-sm max-w-none p-4 text-slate-800 overflow-auto flex-1"
                // DOMPurify strips <script> tags and event handlers
                // Critical for DOCX files which can contain arbitrary HTML
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(previewResult.html),
                }}
              />
            )}

            {/* Unsupported type or fetch failed */}
            {!previewLoading && previewResult?.type === 'unsupported' && (
              <PreviewUnavailable filename={file.original_name} />
            )}

            {!previewLoading && previewResult === null && (
              <div className="flex items-center justify-center flex-1">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
              </div>
            )}

            {/* AI Summarize Panel */}
            <SummarizePanel
              teamId={teamId}
              fileId={file.id}
              mimeType={file.mime_type}
            />
          </div>
        )}

        {/* ════ COMMENTS TAB ════ */}
        {activeTab === 'comments' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 p-4 space-y-3 overflow-y-auto">
              {commentsLoading && (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                </div>
              )}
              {!commentsLoading && (!comments || comments.length === 0) && (
                <p className="text-center text-slate-400 py-10 text-sm">No comments yet. Be the first!</p>
              )}
              {comments?.map(comment => (
                <CommentCard
                  key={comment.id}
                  comment={comment}
                  teamId={teamId}
                  currentUserId={currentUserId}
                  onMutated={() => void queryClient.invalidateQueries({ queryKey: ['comments', teamId, file.id] })}
                />
              ))}
            </div>
            <div className="border-t p-3 flex-shrink-0 bg-white">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Write a comment... Use @username to mention"
                rows={2}
                className="w-full p-3 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              />
              <button
                disabled={!newComment.trim() || addCommentMutation.isPending}
                onClick={() => addCommentMutation.mutate(newComment)}
                className="mt-2 w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {addCommentMutation.isPending ? 'Posting...' : 'Post Comment'}
              </button>
            </div>
          </div>
        )}

        {/* ════ VERSIONS TAB ════ */}
        {activeTab === 'versions' && (
          <div className="p-4 space-y-3">
        {/* Save Version button — visible to editors+ */}
            {(userRole === 'editor' || userRole === 'admin') && (
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-400">Snapshots are created on upload or manually.</p>
                <button
                  id="save-version-btn"
                  onClick={() => {
                    const name = window.prompt('Version label (optional):', '')
                    if (name === null) return // user pressed Cancel
                    saveVersionMutation.mutate(name.trim() || undefined)
                  }}
                  disabled={saveVersionMutation.isPending}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm flex-shrink-0"
                >
                  {saveVersionMutation.isPending ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                  )}
                  Save Version
                </button>
              </div>
            )}
            {versionsLoading && (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
              </div>
            )}
            {!versionsLoading && versions.length === 0 && (
              <div className="text-center text-slate-400 py-10">
                <p className="text-sm">No version history yet.</p>
                <p className="text-xs mt-1">Upload the file again or click "Save Version" to create one.</p>
              </div>
            )}
            {versions.map((v, idx) => (
              <div
                key={v.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-700">Version {v.version_number}</span>
                    {idx === 0 && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">
                        current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatBytes(v.file_size)} · {v.uploader?.username ?? 'unknown'} · {format(new Date(v.created_at), 'MMM d, HH:mm')}
                  </p>
                </div>
                {idx > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Restore version ${v.version_number}? Current state is saved first.`)) {
                        restoreVersionMutation.mutate(v.version_number)
                      }
                    }}
                    disabled={restoreVersionMutation.isPending}
                    className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                  >
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ════ LOCK TAB ════ */}
        {activeTab === 'lock' && (
          <div className="p-4 space-y-4">
            {!lockStatus && (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
              </div>
            )}

            {lockStatus && !isLocked && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 space-y-2">
                <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                <p className="text-sm">File is not currently locked</p>
                <p className="text-xs text-slate-300">Click Edit above to start editing</p>
              </div>
            )}

            {lockStatus && isLocked && (
              <>
                <div className={`p-4 rounded-lg border flex flex-col items-center text-center ${isLockedByMe ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                  <svg className={`w-10 h-10 mb-2 ${isLockedByMe ? 'text-blue-500' : 'text-amber-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <h3 className="font-bold text-slate-800">File is Locked</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    {isLockedByMe
                      ? 'You are currently editing this file.'
                      : `Being edited by ${lockStatus.lockedBy?.username}`}
                  </p>
                  <div className="mt-4 p-3 bg-white bg-opacity-60 rounded border border-inherit w-full text-left space-y-1">
                    {lockStatus.editingStartedAt && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Started</span>
                        <span>{format(new Date(lockStatus.editingStartedAt), 'HH:mm:ss')}</span>
                      </div>
                    )}
                    {lockStatus.timeRemainingSeconds != null && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Expires in</span>
                        <span>{Math.ceil(lockStatus.timeRemainingSeconds / 60)} min</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Admin force unlock — only visible to admins, only when someone else holds lock */}
                {/* WHY only non-admin locks: if you hold the lock, use Done Editing instead */}
                {isAdmin && !isLockedByMe && (
                  <div className="border border-red-200 rounded-lg p-3 bg-red-50">
                    <p className="text-xs text-red-700 font-semibold mb-1">Admin Action</p>
                    <p className="text-xs text-red-600 mb-3">
                      Force-releasing a lock will interrupt the user who is currently editing.
                      Use this only when someone is unreachable or their session is stuck.
                    </p>
                    <button
                      onClick={handleForceUnlock}
                      disabled={isForcing}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                      </svg>
                      {isForcing ? 'Releasing...' : 'Force Release Lock'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ════ SHARING TAB ════ */}
        {activeTab === 'sharing' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Share Links</h3>
              <button
                onClick={onShare}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
              >
                + New Link
              </button>
            </div>

            {sharesLoading && (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
              </div>
            )}

            {!sharesLoading && (!shares || shares.length === 0) && (
              <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <svg className="w-10 h-10 text-slate-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                <p className="text-sm text-slate-400">No active share links.</p>
                <button
                  onClick={onShare}
                  className="mt-3 text-xs font-semibold px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors"
                >
                  Create first link
                </button>
              </div>
            )}

            {!sharesLoading && shares && shares.length > 0 && (
              <div className="space-y-3">
                {shares.map(link => {
                  const isCreator = link.created_by === currentUserId;
                  const canRevoke = isCreator || isAdmin;
                  const isExpired = link.expiration_date && new Date(link.expiration_date) < new Date();

                  return (
                    <div key={link.id} className="p-3 border rounded-lg bg-white shadow-sm space-y-2 group">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="text-[11px] font-mono text-slate-400 truncate" title={link.token}>
                            {link.token}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${isExpired ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {isExpired ? 'Expired' : 'Active'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {link.downloads_count} downloads {link.download_limit ? `/ ${link.download_limit}` : ''}
                            </span>
                          </div>
                        </div>
                        {canRevoke && (
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={() => {
                                const url = `${window.location.origin}/share/${link.token}`;
                                navigator.clipboard.writeText(url).then(() => {
                                  toast.success('Link copied to clipboard');
                                }).catch(() => toast.error('Failed to copy link'));
                              }}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-all"
                              title="Copy link"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                              </svg>
                            </button>
                            <button
                              onClick={() => { if (window.confirm('Revoke this share link immediately?')) revokeShareMutation.mutate(link.token) }}
                              disabled={revokeShareMutation.isPending}
                              className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                              title="Revoke link"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-50">
                        <span>Created {format(new Date(link.created_at), 'MMM d')}</span>
                        {link.expiration_date && (
                          <span>Expires {format(new Date(link.expiration_date), 'MMM d, HH:mm')}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <p className="text-[10px] text-indigo-700 leading-relaxed font-medium">
                <span className="font-bold">Pro Tip:</span> Share links grant access to guests without accounts.
                Team members should use their direct dashboard link instead.
              </p>
            </div>
          </div>
        )}

      </div>

    </div>
  )
}

// ─── CommentCard ──────────────────────────────────────────────────────────────

function CommentCard({
  comment, teamId, currentUserId, onMutated,
}: {
  comment: Comment
  teamId: number
  currentUserId: number
  onMutated: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(comment.content)
  const isOwner = comment.user_id === currentUserId

  const editMutation = useMutation({
    mutationFn: (content: string) => editComment(teamId, comment.id, content),
    onSuccess: () => {
      setIsEditing(false);
      onMutated();
      toast.success('Comment updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to update comment');
    }
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteComment(teamId, comment.id),
    onSuccess: () => {
      onMutated();
      toast.success('Comment deleted');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to delete comment');
    }
  })

  return (
    <div className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-100 group">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
            {comment.user.username[0].toUpperCase()}
          </div>
          <span className="text-xs font-bold text-blue-700">{comment.user.username}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] text-slate-400 mr-1">
            {format(new Date(comment.created_at), 'MMM d, HH:mm')}
          </span>
          {isOwner && !isEditing && (
            <>
              <button
                onClick={() => { setEditText(comment.content); setIsEditing(true) }}
                className="p-1 rounded hover:bg-slate-200 text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-all"
                title="Edit comment"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <button
                onClick={() => { if (window.confirm('Delete this comment?')) deleteMutation.mutate() }}
                disabled={deleteMutation.isPending}
                className="p-1 rounded hover:bg-red-100 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                title="Delete comment"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={2}
            className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setIsEditing(false)} className="text-xs px-2 py-1 rounded text-slate-500 hover:bg-slate-200">Cancel</button>
            <button
              onClick={() => editMutation.mutate(editText)}
              disabled={!editText.trim() || editMutation.isPending}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {comment.content.split(/(@\w+)/g).map((part, i) =>
            part.startsWith('@')
              ? <span key={i} className="text-blue-600 font-semibold">{part}</span>
              : part
          )}
        </p>
      )}
    </div>
  )
}

// ─── SummarizePanel ───────────────────────────────────────────────────────────

function SummarizePanel({ teamId, fileId, mimeType }: {
  teamId: number
  fileId: number
  mimeType: string | null
}) {
  const [summary, setSummary] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // All file types where text extraction is supported.
  // PDF is intentionally excluded — most PDFs are image-based (scanned) and cannot be extracted reliably.
  const canSummarize = mimeType && [
    // Documents
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword',                                                        // .doc
    // Spreadsheets
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // .xlsx
    'application/vnd.ms-excel',                                                  // .xls
    // Text & data
    'text/plain', 'text/csv', 'application/json', 'text/markdown', 'text/x-markdown',
    // Code
    'application/javascript', 'text/javascript', 'text/typescript',
    'application/typescript', 'text/x-python', 'text/x-java-source',
    'text/html', 'text/css', 'application/xml', 'text/xml',
    'application/x-yaml', 'text/yaml',
  ].includes(mimeType)

  // Also allow by file extension for files with generic MIME types
  const canSummarizeByExt = !canSummarize && [
    'docx', 'doc', 'xlsx', 'xls', 'txt', 'csv', 'json', 'md',
    'ts', 'js', 'py', 'java', 'cs', 'sql', 'html', 'css', 'yaml', 'yml'
  ].some(ext => mimeType?.endsWith(ext))

  const isPdf = mimeType === 'application/pdf' || mimeType?.endsWith('pdf')
  const showSummarize = canSummarize || canSummarizeByExt

  if (isPdf) {
    return (
      <div className="mt-4 border-t border-gray-100 pt-4 px-4 pb-4 bg-slate-50/50 text-center">
        <p className="text-xs text-gray-500 flex flex-col items-center gap-1.5">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          AI Summary is not available for PDF files — PDFs are often image-based. Try converting to DOCX or TXT to enable summarization.
        </p>
      </div>
    )
  }

  if (!showSummarize) {
    return (
      <div className="mt-4 border-t border-gray-100 pt-4 px-4 pb-4 bg-slate-50/50 text-center">
        <p className="text-xs text-gray-500 flex flex-col items-center gap-1.5">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          AI Summary is not available for this file type (images, video, audio, and binary files are not supported).
        </p>
      </div>
    )
  }

  const handleSummarize = async () => {
    setIsLoading(true)
    try {
      const result = await fetchFileSummary(teamId, fileId)
      setSummary(result.summary)
      setFromCache(result.fromCache)
      if (result.fromCache) {
        toast('Showing cached summary', { icon: '⚡' })
      } else {
        toast.success('AI summary generated')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to generate summary')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4 px-4 pb-4 bg-slate-50/50">
      {!summary ? (
        <button
          onClick={() => void handleSummarize()}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 
            bg-purple-50 hover:bg-purple-100 text-purple-700 text-sm font-semibold 
            rounded-lg border border-purple-200 transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
              Generating summary...
            </>
          ) : (
            <>
              {/* Sparkle icon */}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                />
              </svg>
              Summarize with AI
            </>
          )}
        </button>
      ) : (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">
              AI Summary {fromCache && '(cached)'}
            </span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{summary}</p>
          <button
            onClick={() => setSummary(null)}
            className="mt-3 text-xs text-purple-500 hover:text-purple-700 font-medium"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

function PreviewUnavailable({ filename }: { filename: string }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-slate-400 space-y-3 p-8">
      <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-sm text-center">No preview for <span className="font-medium">{filename}</span></p>
      <p className="text-xs text-slate-300 text-center">Supported: PDF · Images · Word · Excel · Text · Code</p>
    </div>
  )
}