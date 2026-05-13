// src/pages/InviteMember.tsx
//
// PURPOSE: Dedicated page for team invitation management.
//          Allows admins to manage the team's public invite code/link.

import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTeam } from '@/api/teams'
import InviteBox from '@/components/InviteBox'

export default function InviteMember() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    // Parse teamId from URL params
    const teamId = parseInt(id ?? '0', 10)

    // ─── DATA FETCHING ───────────────────────────────────────────────────────

    const { data: team, isLoading, isError } = useQuery({
        queryKey: ['team', teamId],
        queryFn: () => fetchTeam(teamId),
        enabled: teamId > 0,
        retry: 1
    })

    // ─── LOADING & ERROR STATES ──────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="p-8 max-w-2xl mx-auto animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-6" />
                <div className="h-8 bg-gray-200 rounded w-64 mb-2" />
                <div className="h-4 bg-gray-100 rounded w-96 mb-12" />
                <div className="h-64 bg-gray-50 rounded-xl border border-gray-100" />
            </div>
        )
    }

    if (isError || !team) {
        return (
            <div className="p-8 max-w-2xl mx-auto text-center">
                <div className="bg-red-50 border border-red-200 rounded-xl p-8">
                    <p className="text-red-700 font-medium mb-2">Team not found</p>
                    <p className="text-red-500 text-sm mb-6">
                        The team you're looking for doesn't exist or you don't have access.
                    </p>
                    <button
                        onClick={() => navigate('/teams')}
                        className="bg-white border border-red-200 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                    >
                        Return to teams
                    </button>
                </div>
            </div>
        )
    }

    // ─── LOGIC ───────────────────────────────────────────────────────────────

    const isAdmin = team.myRole === 'admin'

    // ─── RENDER ──────────────────────────────────────────────────────────────

    return (
        <div className="p-6 max-w-2xl mx-auto">
            {/* Breadcrumb / Back button */}
            <button
                onClick={() => navigate(`/teams/${teamId}`)}
                className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-8 transition-colors group"
            >
                <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to dashboard
            </button>

            {/* Page Header */}
            <div className="mb-10">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Invite new members</h1>
                <p className="text-gray-600 leading-relaxed">
                    Invite colleagues to <span className="font-semibold text-gray-900">{team.name}</span> to start collaborating on files and projects.
                </p>
            </div>

            {/* The Invite Management Box */}
            <InviteBox teamId={teamId} isAdmin={isAdmin} />

            {/* Permission Warning (if not admin) */}
            {!isAdmin && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex gap-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-amber-900 mb-1">Permission Required</h3>
                        <p className="text-sm text-amber-700">
                            Only team administrators can generate, view, or manage invite codes.
                            Please contact a team admin if you need to invite someone.
                        </p>
                    </div>
                </div>
            )}

            {/* Additional Tips Section */}
            <div className="mt-12 pt-8 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-900 mb-4">Invitation Tips</h4>
                <ul className="space-y-4">
                    <li className="flex gap-3 text-sm text-gray-600">
                        <span className="text-blue-500 font-bold">•</span>
                        <span>Invitees will join as <span className="font-medium text-gray-900">Viewers</span> by default. You can upgrade their role in Team Settings later.</span>
                    </li>
                    <li className="flex gap-3 text-sm text-gray-600">
                        <span className="text-blue-500 font-bold">•</span>
                        <span>The invite link is public. Anyone with the link can join your team if they have a CloudTeams account.</span>
                    </li>
                </ul>
            </div>
        </div>
    )
}
