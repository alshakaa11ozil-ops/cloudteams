// src/components/InviteBox.tsx
//
// PURPOSE: Reusable component to display and manage team invite codes.
//          Allows admins to copy the code, copy the full invite link,
//          and regenerate the code (invalidating the old one).


import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getInviteCode, regenerateInviteCode } from '../api/teams'
import { toast } from 'react-hot-toast'

interface InviteBoxProps {
    teamId: number
    isAdmin: boolean
}

export default function InviteBox({ teamId, isAdmin }: InviteBoxProps) {
    const queryClient = useQueryClient()
    const [isCopyingCode, setIsCopyingCode] = useState(false)
    const [isCopyingLink, setIsCopyingLink] = useState(false)

    // ─── DATA FETCHING ───────────────────────────────────────────────────────

    // Only fetch if teamId is valid and user is an admin
    const { data, isLoading, error } = useQuery({
        queryKey: ['invite-code', teamId],
        queryFn: () => getInviteCode(teamId),
        enabled: !!teamId && isAdmin,
        retry: 1,
    })

    // ─── MUTATIONS ───────────────────────────────────────────────────────────

    const regenerateMutation = useMutation({
        mutationFn: () => regenerateInviteCode(teamId),
        onSuccess: () => {
            // Refetch the new code immediately
            queryClient.invalidateQueries({ queryKey: ['invite-code', teamId] })
            toast.success('Invite code regenerated successfully')
        },
        onError: (err: any) => {
            console.error('[regenerateMutation]', err)
            toast.error(err.response?.data?.error || 'Failed to regenerate code')
        }
    })

    // ─── LOGIC ───────────────────────────────────────────────────────────────

    if (!isAdmin) return null

    // Fallback if data is not yet loaded or request failed
    const inviteCode = data?.code || '••••••••'
    const inviteLink = `${window.location.origin}/join/${inviteCode}`

    const copyToClipboard = async (text: string, setter: (val: boolean) => void) => {
        try {
            await navigator.clipboard.writeText(text)
            setter(true)
            setTimeout(() => setter(false), 2000) // Reset "Copied!" state after 2s
            toast.success('Copied to clipboard')
        } catch (err) {
            console.error('[copyToClipboard]', err)
            toast.error('Failed to copy to clipboard')
        }
    }

    const handleRegenerate = () => {
        if (window.confirm('Warning: Regenerating the code will immediately invalidate the current one. Anyone using the old link will no longer be able to join. Continue?')) {
            regenerateMutation.mutate()
        }
    }

    // ─── RENDER ──────────────────────────────────────────────────────────────

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8 transition-all hover:shadow-md">
            <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-semibold text-gray-900">Team invite code</h2>
                <div className="bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                    Admin Only
                </div>
            </div>
            <p className="text-sm text-gray-500 mb-6">
                Share this code or link to invite people to your team. Regenerating it immediately invalidates the old one.
            </p>

            <div className="flex flex-col gap-4">
                {/* Code display area */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-center justify-between group">
                    <div className="flex flex-col">
                        <span className={`text-xl font-mono font-bold tracking-widest text-gray-800 uppercase ${isLoading ? 'animate-pulse opacity-50' : ''}`}>
                            {isLoading ? '••••••••' : inviteCode}
                        </span>
                        {error && <span className="text-xs text-red-500 mt-1">Failed to load code</span>}
                    </div>
                    <button
                        onClick={() => copyToClipboard(inviteCode, setIsCopyingCode)}
                        disabled={isLoading || inviteCode === '••••••••'}
                        className="text-blue-600 hover:text-blue-700 text-sm font-semibold px-3 py-1 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                        {isCopyingCode ? (
                            <span className="flex items-center gap-1">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Copied
                            </span>
                        ) : 'Copy code'}
                    </button>
                </div>

                {/* Secondary Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                        onClick={() => copyToClipboard(inviteLink, setIsCopyingLink)}
                        disabled={isLoading || inviteCode === '••••••••'}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        {isCopyingLink ? 'Link Copied!' : 'Copy invite link'}
                    </button>

                    <button
                        onClick={handleRegenerate}
                        disabled={regenerateMutation.isPending || isLoading}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 border border-red-100 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 hover:border-red-200 transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                        <svg className={`w-4 h-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Regenerate code
                    </button>
                </div>
            </div>
        </div>
    )
}
