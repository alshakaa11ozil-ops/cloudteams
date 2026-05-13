// frontend/src/components/AnnouncementCard.tsx
//
// PURPOSE: Display a single announcement with full body text.
//          Admin/author gets edit + delete controls.
//          Pinned announcements show a visual pin badge.
//
// INPUTS:
//   announcement  — the full announcement object
//   teamId        — for delete/edit API calls
//   currentUserId — to check if current user is the author
//   isAdmin       — controls edit/delete/pin visibility
//   onEdit        — called when Edit is clicked (parent opens modal)

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { deleteAnnouncement, updateAnnouncement } from '../api/announcements'
import type { Announcement } from '../types'

interface AnnouncementCardProps {
    announcement: Announcement
    teamId: number
    currentUserId: number
    isAdmin: boolean
    onEdit: (announcement: Announcement) => void
}

export default function AnnouncementCard({
    announcement,
    teamId,
    currentUserId,
    isAdmin,
    onEdit,
}: AnnouncementCardProps) {
    const queryClient = useQueryClient()

    // Controls inline delete confirmation
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    // Can this user edit/delete this announcement?
    // Backend rule: author OR admin. Mirror it here for UI.
    const isAuthor = announcement.authorId === currentUserId
    const canEdit = isAuthor || isAdmin
    const canDelete = isAuthor || isAdmin

    // ── Delete mutation ──────────────────────────────────────────────────────
    const deleteMutation = useMutation({
        mutationFn: () => deleteAnnouncement(teamId, announcement.id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['announcements', teamId] })
            toast.success('Announcement deleted')
            setShowDeleteConfirm(false)
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to delete announcement')
            setShowDeleteConfirm(false)
        }
    })

    // ── Pin toggle mutation (admin only) ─────────────────────────────────────
    const pinMutation = useMutation({
        mutationFn: () => updateAnnouncement(teamId, announcement.id, {
            isPinned: !announcement.isPinned
        }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['announcements', teamId] })
            toast.success(announcement.isPinned ? 'Unpinned' : 'Pinned to top')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to update pin status')
        }
    })

    // Format date as "Apr 26, 2026 at 2:30 PM"
    const formattedDate = new Date(announcement.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }) + ' at ' + new Date(announcement.createdAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
    })

    const wasEdited = announcement.updatedAt !== announcement.createdAt

    return (
        <div className={`
      rounded-lg border p-4 transition-colors
      ${announcement.isPinned
                ? 'bg-amber-50 border-amber-200'   // pinned = amber tint
                : 'bg-white border-gray-200'
            }
    `}>

            {/* ── Header row ──────────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {/* Pin badge */}
                    {announcement.isPinned && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300 flex-shrink-0">
                            📌 Pinned
                        </span>
                    )}
                    {/* Title */}
                    <h3 className="text-sm font-bold text-gray-900 leading-snug">
                        {announcement.title}
                    </h3>
                </div>

                {/* Action buttons — only for author or admin */}
                {(canEdit || canDelete) && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {/* Pin/unpin toggle — admin only */}
                        {isAdmin && (
                            <button
                                onClick={() => pinMutation.mutate()}
                                disabled={pinMutation.isPending}
                                title={announcement.isPinned ? 'Unpin' : 'Pin to top'}
                                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                            >
                                <svg className="w-4 h-4" fill={announcement.isPinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                </svg>
                            </button>
                        )}

                        {/* Edit button */}
                        {canEdit && !showDeleteConfirm && (
                            <button
                                onClick={() => onEdit(announcement)}
                                title="Edit announcement"
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                    />
                                </svg>
                            </button>
                        )}

                        {/* Delete button / confirm */}
                        {canDelete && (
                            showDeleteConfirm ? (
                                <div className="flex items-center gap-1">
                                    <span className="text-xs text-gray-600">Delete?</span>
                                    <button
                                        onClick={() => deleteMutation.mutate()}
                                        disabled={deleteMutation.isPending}
                                        className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 px-1"
                                    >
                                        {deleteMutation.isPending ? '...' : 'Yes'}
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="text-xs text-gray-400 hover:text-gray-600 px-1"
                                    >
                                        No
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    title="Delete announcement"
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                        />
                                    </svg>
                                </button>
                            )
                        )}
                    </div>
                )}
            </div>

            {/* ── Body text ────────────────────────────────────────────────────── */}
            {/* whitespace-pre-wrap: respects line breaks the admin typed */}
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mb-3">
                {announcement.body}
            </p>

            {/* ── Footer: author + date ─────────────────────────────────────────── */}
            <div className="flex items-center gap-2 text-xs text-gray-400">
                {/* Author avatar */}
                <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold" style={{ fontSize: '9px' }}>
                        {announcement.author.username.charAt(0).toUpperCase()}
                    </span>
                </div>
                <span className="font-medium text-gray-500">
                    {announcement.author.username}
                </span>
                <span>·</span>
                <span>{formattedDate}</span>
                {wasEdited && (
                    <>
                        <span>·</span>
                        <span className="italic">edited</span>
                    </>
                )}
            </div>
        </div>
    )
}