// frontend/src/components/AnnouncementModal.tsx
//
// PURPOSE: Modal form for creating OR editing an announcement.
//          Same component handles both modes — mode determined by
//          whether `existing` prop is passed.
//
// INPUTS:
//   teamId    — which team this belongs to
//   existing  — if provided, pre-fills form (edit mode)
//   isAdmin   — controls whether isPinned toggle is shown
//               (only admins can pin — matches backend rule)
//   onClose   — called when modal should close
//   onSaved   — called after successful create or update
//               parent invalidates the query

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
    createAnnouncement,
    updateAnnouncement,
} from '../api/announcements'
import type { Announcement } from '../types'

interface AnnouncementModalProps {
    teamId: number
    existing?: Announcement      // undefined = create mode, defined = edit mode
    isAdmin: boolean
    onClose: () => void
}

export default function AnnouncementModal({
    teamId,
    existing,
    isAdmin,
    onClose,
}: AnnouncementModalProps) {
    const queryClient = useQueryClient()
    const isEditMode = !!existing

    // Form state — pre-filled in edit mode
    const [title, setTitle] = useState(existing?.title ?? '')
    const [body, setBody] = useState(existing?.body ?? '')
    const [isPinned, setIsPinned] = useState(existing?.isPinned ?? false)

    // Basic validation
    const isTitleEmpty = title.trim().length === 0
    const isBodyEmpty = body.trim().length === 0
    const isInvalid = isTitleEmpty || isBodyEmpty

    // ── Create mutation ────────────────────────────────────────────────────────
    const createMutation = useMutation({
        mutationFn: () => createAnnouncement(teamId, {
            title: title.trim(),
            body: body.trim(),
            isPinned,
        }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['announcements', teamId] })
            toast.success('Announcement posted')
            onClose()
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to post announcement')
        }
    })

    // ── Edit mutation ──────────────────────────────────────────────────────────
    const editMutation = useMutation({
        mutationFn: () => updateAnnouncement(teamId, existing!.id, {
            title: title.trim(),
            body: body.trim(),
            isPinned,
        }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['announcements', teamId] })
            toast.success('Announcement updated')
            onClose()
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to update announcement')
        }
    })

    const isPending = createMutation.isPending || editMutation.isPending

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (isInvalid) return
        if (isEditMode) {
            editMutation.mutate()
        } else {
            createMutation.mutate()
        }
    }

    // Close on backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose()
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-900">
                        {isEditMode ? 'Edit announcement' : 'Post announcement'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

                    {/* Title */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1.5">
                            Title <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="e.g. Project deadline changed"
                            maxLength={120}
                            autoFocus
                            className="
                w-full px-3 py-2 text-sm rounded-lg border border-gray-300
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              "
                        />
                        {/* Character counter */}
                        <p className="text-xs text-gray-400 mt-1 text-right">{title.length}/120</p>
                    </div>

                    {/* Body */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1.5">
                            Message <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            placeholder="Write your announcement here..."
                            rows={5}
                            maxLength={2000}
                            className="
                w-full px-3 py-2 text-sm rounded-lg border border-gray-300
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                resize-none
              "
                        />
                        <p className="text-xs text-gray-400 mt-1 text-right">{body.length}/2000</p>
                    </div>

                    {/* Pin toggle — only shown to admins */}
                    {/* WHY: Backend enforces the same rule — non-admins get 403 if they
              try to set isPinned. We also hide it in the UI so it's not
              confusing for editors who can edit body but not pin. */}
                    {isAdmin && (
                        <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <button
                                type="button"
                                onClick={() => setIsPinned(p => !p)}
                                className={`
                  relative w-10 h-6 rounded-full transition-colors flex-shrink-0
                  ${isPinned ? 'bg-amber-500' : 'bg-gray-300'}
                `}
                            >
                                {/* Toggle knob */}
                                <span className={`
                  absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow
                  transition-transform
                  ${isPinned ? 'translate-x-4' : 'translate-x-0'}
                `} />
                            </button>
                            <div>
                                <p className="text-sm font-semibold text-gray-900">
                                    📌 Pin this announcement
                                </p>
                                <p className="text-xs text-gray-500">
                                    Pinned announcements appear at the top of the list
                                </p>
                            </div>
                        </div>
                    )}
                </form>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isInvalid || isPending}
                        className="
              px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white
              text-sm font-semibold rounded-lg transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed shadow-sm
            "
                    >
                        {isPending
                            ? (isEditMode ? 'Saving...' : 'Posting...')
                            : (isEditMode ? 'Save changes' : 'Post announcement')
                        }
                    </button>
                </div>
            </div>
        </div>
    )
}