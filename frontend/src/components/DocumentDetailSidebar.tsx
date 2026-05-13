// frontend/src/components/DocumentDetailSidebar.tsx
//
// PURPOSE: Sidebar panel showing document details — same tab pattern as
//          FileDetailSidebar but for native CloudTeams documents.
//
// TABS:
//   Preview  — word count, last saved, creator info (no binary preview needed)
//   Comments — thread of comments on this document
//   Versions — not applicable (Yjs IS the version history) — show last_saved history
//   Sharing  — generate share link for this document
//
// NOTE: No Lock tab — collaborative editing via CRDT handles concurrency.
//       No file-style locking needed or useful for documents.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import type { DocumentSummary } from '@/types'
import { fetchDocumentComments, addDocumentComment, editDocumentComment, deleteDocumentComment, previewDocument } from '@/api/documents'

interface DocumentDetailSidebarProps {
    document: DocumentSummary | null
    teamId: number
    currentUserId: number
    isAdmin: boolean
    onClose: () => void
}

type TabId = 'preview' | 'comments' | 'sharing'

// Inside DocumentDetailSidebar.tsx — add this sub-component:

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
                        onMutated={() => void queryClient.invalidateQueries({ queryKey: ['document_comments', teamId, documentId] })}
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
                        className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setIsEditing(false)} className="text-xs px-2 py-1 rounded text-slate-500 hover:bg-slate-200">Cancel</button>
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
// DocumentPreview — fetches HTML from the preview endpoint and renders it
// ---------------------------------------------------------------------------
function DocumentPreview({ document, teamId }: { document: DocumentSummary; teamId: number }) {
    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['doc_preview', teamId, document.id],
        queryFn: () => previewDocument(teamId, document.id),
        staleTime: 30_000,  // Cache for 30s — re-fetch on tab switch after that
        retry: 1,
    })

    return (
        <div className="space-y-4">
            {/* Content preview panel */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Content Preview</span>
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
                            Could not load preview. <button onClick={() => void refetch()} className="underline">Try again</button>
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

            {/* Metadata */}
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
                    <span className="text-gray-900 font-medium">{document.creatorName ?? 'Unknown'}</span>
                </div>
            </div>
        </div>
    )
}

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

    const tabs: { id: TabId; label: string }[] = [
        { id: 'preview', label: 'Preview' },
        { id: 'comments', label: 'Comments' },
        { id: 'sharing', label: 'Sharing' },
    ]

    return (
        <aside className="w-80 bg-white border-l border-gray-200 flex flex-col flex-shrink-0 overflow-hidden">

            {/* Header */}
            <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        {/* Document icon */}
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
                    {/* Open editor button */}
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

                {/* Comments tab */}
                {activeTab === 'comments' && (
                    <div className="h-full">
                        <DocumentComments
                            documentId={document.id}
                            teamId={teamId}
                            currentUserId={currentUserId}
                        />
                    </div>
                )}

                {/* Sharing tab */}
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
