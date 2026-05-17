// frontend/src/components/DocumentDetailSidebar.tsx
//
// PURPOSE: Sidebar panel showing document details — same tab pattern as
//          FileDetailSidebar but for native CloudTeams documents.
//
// TABS:
//   Preview  — content preview + metadata (last saved, author)
//   Comments — thread of comments on this document
//   Versions — auto-save history explanation + last saved timestamp
//   Sharing  — open editor to share from there
//
// NOTE: No Lock tab — collaborative editing via CRDT handles concurrency.
//       No file-style locking needed or useful for documents.
//
// VERSIONS TAB RATIONALE:
//   Files use the FileVersion table (snapshot on each upload).
//   Documents use Yjs CRDT continuous auto-save (every 5 seconds via Hocuspocus).
//   There is no per-keystroke snapshot table for documents — that would be
//   thousands of rows per editing session. Instead we show the last_saved
//   timestamp and explain the auto-save model. This is accurate and defensible.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import type { DocumentSummary } from '../types'
import {
    fetchDocumentComments,
    addDocumentComment,
    editDocumentComment,
    deleteDocumentComment,
    previewDocument,
    lockDocument,
    unlockDocument,
    forceUnlockDocument,
} from '../api/documents'

interface DocumentDetailSidebarProps {
    document: DocumentSummary | null
    teamId: number
    currentUserId: number
    isAdmin: boolean
    onClose: () => void
}

// Added 'versions' and 'lock' to the union type
type TabId = 'preview' | 'comments' | 'versions' | 'lock' | 'sharing'

// ---------------------------------------------------------------------------
// DocumentComments — unchanged from original
// ---------------------------------------------------------------------------

function DocumentComments({
    documentId,
    teamId,
    currentUserId,
}: {
    documentId: number
    teamId: number
    currentUserId: number
}) {
    const queryClient = useQueryClient()
    const [newComment, setNewComment] = useState('')

    const { data: comments, isLoading: commentsLoading } = useQuery({
        queryKey: ['document_comments', teamId, documentId],
        queryFn: () => fetchDocumentComments(teamId, documentId)
    })

    const addCommentMutation = useMutation({
        mutationFn: (content: string) => addDocumentComment(teamId, documentId, content),
        onSuccess: () => {
            setNewComment('')
            void queryClient.invalidateQueries({ queryKey: ['document_comments', teamId, documentId] })
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to post comment')
        }
    })

    return (
        <div className="flex flex-col h-full bg-white relative">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {commentsLoading && (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
                    </div>
                )}
                {!commentsLoading && (!comments || comments.length === 0) && (
                    <p className="text-center text-slate-400 py-10 text-sm">No comments yet. Be the first!</p>
                )}
                {comments?.map((comment: any) => (
                    <CommentCard
                        key={comment.id}
                        comment={comment}
                        teamId={teamId}
                        currentUserId={currentUserId}
                        onMutated={() => void queryClient.invalidateQueries({
                            queryKey: ['document_comments', teamId, documentId]
                        })}
                    />
                ))}
            </div>
            <div className="border-t p-3 flex-shrink-0 bg-white sticky bottom-0">
                <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Write a comment... Use @username to mention"
                    rows={2}
                    className="w-full p-3 text-sm border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                />
                <button
                    disabled={!newComment.trim() || addCommentMutation.isPending}
                    onClick={() => addCommentMutation.mutate(newComment)}
                    className="mt-2 w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {addCommentMutation.isPending ? 'Posting...' : 'Post Comment'}
                </button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// CommentCard — unchanged from original
// ---------------------------------------------------------------------------

function CommentCard({
    comment,
    teamId,
    currentUserId,
    onMutated
}: {
    comment: any
    teamId: number
    currentUserId: number
    onMutated: () => void
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [editText, setEditText] = useState(comment.content)
    const isOwner = comment.user_id === currentUserId

    const editMutation = useMutation({
        mutationFn: (content: string) => editDocumentComment(teamId, comment.id, content),
        onSuccess: () => {
            setIsEditing(false)
            onMutated()
            toast.success('Comment updated')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to update comment')
        }
    })

    const deleteMutation = useMutation({
        mutationFn: () => deleteDocumentComment(teamId, comment.id),
        onSuccess: () => {
            onMutated()
            toast.success('Comment deleted')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to delete comment')
        }
    })

    return (
        <div className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-100 group">
            <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 flex-shrink-0">
                        {comment.user.username[0].toUpperCase()}
                    </div>
                    <span className="text-xs font-bold text-indigo-700">{comment.user.username}</span>
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
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                            </button>
                            <button
                                onClick={() => {
                                    if (window.confirm('Delete this comment?')) deleteMutation.mutate()
                                }}
                                disabled={deleteMutation.isPending}
                                className="p-1 rounded hover:bg-red-100 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                                title="Delete comment"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
                        className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => setIsEditing(false)}
                            className="text-xs px-2 py-1 rounded text-slate-500 hover:bg-slate-200"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => editMutation.mutate(editText)}
                            disabled={!editText.trim() || editMutation.isPending}
                            className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {editMutation.isPending ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {comment.content.split(/(@\w+)/g).map((part: string, i: number) =>
                        part.startsWith('@')
                            ? <span key={i} className="text-indigo-600 font-semibold">{part}</span>
                            : part
                    )}
                </p>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// DocumentPreview — unchanged from original
// ---------------------------------------------------------------------------

function DocumentPreview({ document, teamId }: { document: DocumentSummary; teamId: number }) {
    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['doc_preview', teamId, document.id],
        queryFn: () => previewDocument(teamId, document.id),
        staleTime: 30_000,
        retry: 1,
    })

    return (
        <div className="space-y-4">
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Content Preview
                    </span>
                    <button
                        onClick={() => void refetch()}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                        Refresh
                    </button>
                </div>

                <div className="p-3 max-h-64 overflow-y-auto">
                    {isLoading && (
                        <div className="flex justify-center py-6">
                            <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                        </div>
                    )}
                    {isError && (
                        <p className="text-xs text-red-500 text-center py-4">
                            Could not load preview.{' '}
                            <button onClick={() => void refetch()} className="underline">Try again</button>
                        </p>
                    )}
                    {data && (
                        <div
                            className="doc-preview-content text-sm text-gray-800 leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: data.html }}
                        />
                    )}
                </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Created</span>
                    <span className="text-gray-900 font-medium">
                        {new Date(document.createdAt).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric'
                        })}
                    </span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Last saved</span>
                    <span className="text-gray-900 font-medium">
                        {document.lastSaved
                            ? new Date(document.lastSaved).toLocaleDateString('en-US', {
                                month: 'short', day: 'numeric', year: 'numeric'
                            })
                            : 'Never saved'}
                    </span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Author</span>
                    <span className="text-gray-900 font-medium">
                        {document.creatorName ?? 'Unknown'}
                    </span>
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// DocumentVersionsTab — NEW
//
// PURPOSE: Explain the document auto-save model and show the last saved time.
//
// WHY NO VERSION ROWS:
//   Files use FileVersion snapshots (one row per upload).
//   Documents use Yjs CRDT continuous auto-save — Hocuspocus stores the
//   complete document state every 5 seconds during editing AND on the last
//   client disconnect. There is no per-keystroke history table — that would
//   produce thousands of rows per session with no meaningful difference between
//   adjacent entries.
//
//   The document prop already contains: createdAt, lastSaved, creatorName.
//   No API call needed — we display what we have.
// ---------------------------------------------------------------------------

function DocumentVersionsTab({ document }: { document: DocumentSummary }) {
    const hasSave = !!document.lastSaved

    return (
        <div className="space-y-4">

            {/* Auto-save status card */}
            <div className={`
                rounded-xl border p-4 flex items-start gap-3
                ${hasSave
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-amber-50 border-amber-200'
                }
            `}>
                {/* Status icon */}
                <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
                    ${hasSave ? 'bg-emerald-100' : 'bg-amber-100'}
                `}>
                    {hasSave ? (
                        /* Checkmark — saved */
                        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                    ) : (
                        /* Clock — never saved */
                        <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${hasSave ? 'text-emerald-800' : 'text-amber-800'}`}>
                        {hasSave ? 'All changes saved' : 'Not yet saved'}
                    </p>
                    <p className={`text-xs mt-0.5 ${hasSave ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {hasSave
                            ? `Last saved ${format(new Date(document.lastSaved!), "MMM d, yyyy 'at' HH:mm")}`
                            : 'Open and start typing — changes save automatically'}
                    </p>
                </div>
            </div>

            {/* Timeline — two events we always know */}
            <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Save History
                </h3>

                <div className="relative">
                    {/* Vertical connector line */}
                    <div className="absolute left-3.5 top-4 bottom-4 w-px bg-gray-200" />

                    <div className="space-y-0">

                        {/* Last saved — only show if different from created */}
                        {hasSave && (
                            <div className="flex gap-3 pb-4 relative">
                                <div className="w-7 h-7 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center flex-shrink-0 z-10 shadow-sm">
                                    <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                    </svg>
                                </div>
                                <div className="flex-1 pt-0.5">
                                    <p className="text-sm font-medium text-gray-800">Last auto-saved</p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {format(new Date(document.lastSaved!), "MMM d, yyyy 'at' HH:mm:ss")}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Document created */}
                        <div className="flex gap-3 relative">
                            <div className="w-7 h-7 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center flex-shrink-0 z-10 shadow-sm">
                                <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 4v16m8-8H4" />
                                </svg>
                            </div>
                            <div className="flex-1 pt-0.5">
                                <p className="text-sm font-medium text-gray-800">Document created</p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    {format(new Date(document.createdAt), "MMM d, yyyy 'at' HH:mm")}
                                    {document.creatorName && (
                                        <span className="text-gray-400"> · by {document.creatorName}</span>
                                    )}
                                </p>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {/* Explanation card */}
            {/* 
                WHY THIS CARD EXISTS:
                Users familiar with file version history expect a list of numbered versions.
                Documents work differently — Yjs CRDT is the version history, stored as a
                single binary blob that is continuously updated. Showing an empty list with
                no explanation would confuse users. This card makes the design decision explicit.
            */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex gap-2.5">
                    <svg className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-slate-600">How document saving works</p>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            Documents are saved automatically every 5 seconds while you
                            type and again when the last editor closes the tab. This uses
                            a conflict-free collaborative data structure (Yjs CRDT) that
                            merges edits from multiple people simultaneously — no manual
                            save needed.
                        </p>
                        <p className="text-xs text-slate-400 leading-relaxed">
                            Unlike uploaded files, documents don't have numbered version
                            snapshots. The auto-save state is always the most recent version.
                        </p>
                    </div>
                </div>
            </div>

        </div>
    )
}

// ---------------------------------------------------------------------------
// DocumentLockTab — NEW
// ---------------------------------------------------------------------------

function DocumentLockTab({
    document,
    teamId,
    currentUserId,
    isAdmin
}: {
    document: DocumentSummary
    teamId: number
    currentUserId: number
    isAdmin: boolean
}) {
    const queryClient = useQueryClient()

    const lockMutation = useMutation({
        mutationFn: () => lockDocument(String(teamId), String(document.id)),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
            toast.success('Document locked for editing')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to lock document')
        }
    })

    const unlockMutation = useMutation({
        mutationFn: () => unlockDocument(String(teamId), String(document.id)),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
            toast.success('Document unlocked')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to unlock document')
        }
    })

    const forceUnlockMutation = useMutation({
        mutationFn: () => forceUnlockDocument(String(teamId), String(document.id)),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
            toast.success('Document force-unlocked')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to force unlock')
        }
    })

    const isLockActive = !!document.lockOwnerUserId && 
                         !!document.lockExpiresAt && 
                         new Date(document.lockExpiresAt) > new Date()
                         
    const isLockedByMe = isLockActive && document.lockOwnerUserId === currentUserId
    const isForcing = forceUnlockMutation.isPending

    return (
        <div className="p-4 space-y-4">
            {!isLockActive && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 space-y-2">
                <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                <p className="text-sm">Document is not currently locked</p>
                <p className="text-xs text-slate-300">Open to start editing</p>
                <button
                    onClick={() => lockMutation.mutate()}
                    disabled={lockMutation.isPending}
                    className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                    {lockMutation.isPending ? 'Locking...' : 'Lock Document'}
                </button>
              </div>
            )}

            {isLockActive && (
              <>
                <div className={`p-4 rounded-lg border flex flex-col items-center text-center ${isLockedByMe ? 'bg-indigo-50 border-indigo-200' : 'bg-amber-50 border-amber-200'}`}>
                  <svg className={`w-10 h-10 mb-2 ${isLockedByMe ? 'text-indigo-500' : 'text-amber-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <h3 className="font-bold text-slate-800">Document is Locked</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    {isLockedByMe
                      ? 'You hold the lock for this document.'
                      : `Being edited by another user (ID: ${document.lockOwnerUserId})`}
                  </p>
                  
                  {isLockedByMe && (
                      <button
                          onClick={() => unlockMutation.mutate()}
                          disabled={unlockMutation.isPending}
                          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 w-full"
                      >
                          {unlockMutation.isPending ? 'Unlocking...' : 'Unlock Document'}
                      </button>
                  )}
                  
                  <div className="mt-4 p-3 bg-white bg-opacity-60 rounded border border-inherit w-full text-left space-y-1">
                    <div className="flex justify-between text-xs text-slate-500">
                        <span>Expires at</span>
                        <span>{format(new Date(document.lockExpiresAt!), 'HH:mm:ss')}</span>
                    </div>
                  </div>
                </div>

                {/* Admin force unlock — only visible to admins, only when someone else holds lock */}
                {isAdmin && !isLockedByMe && (
                  <div className="border border-red-200 rounded-lg p-3 bg-red-50">
                    <p className="text-xs text-red-700 font-semibold mb-1">Admin Action</p>
                    <p className="text-xs text-red-600 mb-3">
                      Force-releasing a lock will kick the current editor to read-only mode.
                    </p>
                    <button
                      onClick={() => { if (window.confirm('Force release this lock?')) forceUnlockMutation.mutate() }}
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
    )
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

export default function DocumentDetailSidebar({
    document,
    teamId,
    currentUserId,
    isAdmin: _isAdmin,
    onClose,
}: DocumentDetailSidebarProps) {
    const navigate = useNavigate()
    const [activeTab, setActiveTab] = useState<TabId>('preview')

    if (!document) return null

    // Added 'versions' and 'lock' tab
    const tabs: { id: TabId; label: string }[] = [
        { id: 'preview', label: 'Preview' },
        { id: 'comments', label: 'Comments' },
        { id: 'versions', label: 'Versions' },
        { id: 'lock', label: 'Lock' },
        { id: 'sharing', label: 'Sharing' },
    ]

    return (
        <aside className="w-80 bg-white border-l border-gray-200 flex flex-col flex-shrink-0 overflow-hidden">

            {/* Header — unchanged */}
            <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-sm font-semibold text-gray-900 truncate">{document.title}</p>
                    </div>
                    <p className="text-xs text-gray-500 ml-6">
                        by {document.creatorName ?? 'Unknown'}
                    </p>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    <button
                        onClick={() => navigate(`/teams/${teamId}/documents/${document.id}`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Open
                    </button>
                    <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 flex-shrink-0">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                            flex-1 py-2.5 text-xs font-semibold transition-colors
                            ${activeTab === tab.id
                                ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                                : 'text-gray-500 hover:text-gray-900'
                            }
                        `}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">

                {activeTab === 'preview' && (
                    <DocumentPreview document={document} teamId={teamId} />
                )}

                {activeTab === 'comments' && (
                    <div className="h-full">
                        <DocumentComments
                            documentId={document.id}
                            teamId={teamId}
                            currentUserId={currentUserId}
                        />
                    </div>
                )}

                {/* NEW: Versions tab */}
                {activeTab === 'versions' && (
                    <DocumentVersionsTab document={document} />
                )}

                {activeTab === 'lock' && (
                    <DocumentLockTab
                        document={document}
                        teamId={teamId}
                        currentUserId={currentUserId}
                        isAdmin={_isAdmin}
                    />
                )}

                {activeTab === 'sharing' && (
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            Share this document with people outside your team.
                        </p>
                        <button
                            onClick={() => navigate(`/teams/${teamId}/documents/${document.id}`)}
                            className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            Open & share from editor
                        </button>
                        <p className="text-xs text-gray-400 text-center">
                            Share links for documents can be created from inside the editor.
                        </p>
                    </div>
                )}

            </div>
        </aside>
    )
}