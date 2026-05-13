// src/pages/JoinTeam.tsx
//
// PURPOSE: Allows a user to join a team using an invite code.
//          Handles two entry points:
//          1. /join/:code — magic link (code pre-filled from URL)
//          2. /join       — manual entry (user types the code)
//
// WHY TWO ENTRY POINTS:
//   Magic link: admin shares cloudteams.app/join/ABC12345 in a group chat
//   Manual: admin reads the code aloud or sends it in a message

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { joinTeamByCode } from '@/api/teams'

export default function JoinTeam() {
    const { code: urlCode } = useParams<{ code?: string }>()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    // Pre-fill the input if code came from the URL
    const [code, setCode] = useState(urlCode ?? '')
    const [autoJoining] = useState(!!urlCode)

    const mutation = useMutation({
        mutationFn: (inviteCode: string) => joinTeamByCode(inviteCode),
        onSuccess: (data) => {
            // Invalidate teams cache so TeamList shows the new team
            void queryClient.invalidateQueries({ queryKey: ['teams'] })
            // Navigate to the team they just joined
            navigate(`/teams/${data.team.id}`, { replace: true })
        },
    })

    // Auto-join if code came from URL — fire immediately on mount
    // WHY: Magic link UX — user clicks link → instantly joins → no extra clicks
    useEffect(() => {
        if (urlCode) {
            mutation.mutate(urlCode)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])  // run once on mount only

    const handleSubmit = () => {
        if (!code.trim()) return
        mutation.mutate(code.trim())
    }

    // ── Auto-joining state (magic link) ──────────────────────────────────────

    if (autoJoining && mutation.isPending) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Joining team...</p>
                    <p className="text-gray-400 text-sm mt-1">Just a moment</p>
                </div>
            </div>
        )
    }

    // ─── RENDER ──────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

                {/* Header */}
                <div className="text-center mb-8">
                    <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                            />
                        </svg>
                    </div>
                    <h1 className="text-xl font-semibold text-gray-900">Join a team</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Enter the invite code shared by your team admin
                    </p>
                </div>

                {/* Error banner */}
                {mutation.isError && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
                        <p className="text-sm text-red-700 text-center">
                            {(() => {
                                const err = mutation.error
                                if (
                                    err &&
                                    typeof err === 'object' &&
                                    'response' in err &&
                                    err.response &&
                                    typeof err.response === 'object' &&
                                    'data' in err.response
                                ) {
                                    const data = err.response.data as { error?: string }
                                    return data.error ?? 'Failed to join team'
                                }
                                return 'Failed to join team. Check the code and try again.'
                            })()}
                        </p>
                    </div>
                )}

                {/* Code input */}
                <div className="mb-4">
                    <label
                        htmlFor="invite-code"
                        className="block text-sm font-medium text-gray-700 mb-1"
                    >
                        Invite code
                    </label>
                    <input
                        id="invite-code"
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        // toUpperCase() keeps input consistent with how codes are stored
                        placeholder="e.g. ABC12345"
                        autoFocus
                        autoComplete="off"
                        maxLength={8}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                        className="
              w-full px-3 py-2 rounded-lg border border-gray-300 text-sm
              text-center text-lg font-mono font-semibold tracking-widest
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            "
                    />
                    {/* tracking-widest + font-mono makes code easier to read */}
                </div>

                {/* Join button */}
                <button
                    onClick={handleSubmit}
                    disabled={mutation.isPending || !code.trim()}
                    className="
            w-full py-2.5 px-4 rounded-lg text-sm font-medium
            bg-blue-600 text-white hover:bg-blue-700
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors mb-3
          "
                >
                    {mutation.isPending ? 'Joining...' : 'Join team'}
                </button>

                {/* Back link */}
                <button
                    onClick={() => navigate('/teams')}
                    className="w-full text-sm text-gray-500 hover:text-gray-900 transition-colors text-center"
                >
                    ← Back to my teams
                </button>

            </div>
        </div>
    )
}