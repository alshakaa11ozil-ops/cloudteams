// src/pages/TeamList.tsx
//
// PURPOSE: Shows all teams the logged-in user belongs to.
//          Uses React Query for data fetching, caching, and loading state.
//          Shows skeleton while loading, empty state if no teams, cards if data.
//
// INPUTS:  None (data comes from the backend via React Query)
// OUTPUTS: A grid of team cards or appropriate empty/error states

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchTeams } from '@/api/teams'
import type { Team, TeamRole } from '@/types'

// ─── ROLE BADGE ────────────────────────────────────────────────────────────
//
// Small coloured badge showing the user's role in a team.
// INPUTS:  role — 'viewer' | 'editor' | 'admin'
// OUTPUTS: A coloured pill badge

function RoleBadge({ role }: { role: TeamRole | undefined }) {
    // Map each role to Tailwind colour classes
    const styles: Record<TeamRole, string> = {
        admin: 'bg-purple-100 text-purple-700',
        editor: 'bg-blue-100 text-blue-700',
        viewer: 'bg-gray-100 text-gray-600',
    }

    // Guard: if role is undefined (backend returned something unexpected),
    // render nothing rather than crashing with "cannot read charAt of undefined"
    if (!role) return null

    return (
        <span className={`
      inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
      ${styles[role] ?? 'bg-gray-100 text-gray-600'}
    `}>
            {role.charAt(0).toUpperCase() + role.slice(1)}
        </span>
    )
}

// ─── SKELETON CARD ─────────────────────────────────────────────────────────
//
// Placeholder card shown while data is loading.
// animate-pulse gives the breathing animation.

function SkeletonCard() {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
            <div className="h-5 bg-gray-200 rounded w-3/4 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-full mb-2" />
            <div className="h-3 bg-gray-100 rounded w-2/3 mb-4" />
            <div className="h-5 bg-gray-100 rounded-full w-16" />
        </div>
    )
}

// ─── TEAM CARD ─────────────────────────────────────────────────────────────
//
// Displays a single team. Clicking navigates to the team dashboard.
// INPUTS:  team — Team object from backend
//          onClick — called when card is clicked

function TeamCard({ team, onClick }: { team: Team; onClick: () => void }) {
    const createdDate = new Date(team.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })

    return (
        <button
            onClick={onClick}
            // WHY <button> not <div onClick>: buttons are keyboard-accessible
            // by default. Tab to focus, Enter to activate. A div with onClick
            // is invisible to keyboard and screen reader users.
            className="
        w-full text-left bg-white rounded-xl border border-gray-200 p-6
        hover:border-blue-300 hover:shadow-sm
        transition-all duration-150
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
      "
        >
            {/* Team name + role badge */}
            <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-gray-900 text-base leading-snug">
                    {team.name}
                </h3>
                {/* myRole is what the backend returns — the current user's role */}
                <RoleBadge role={team.myRole} />
            </div>

            {/* Description — clamped to 2 lines */}
            {team.description ? (
                <p className="text-sm text-gray-500 line-clamp-2 mb-4">
                    {team.description}
                </p>
            ) : (
                <p className="text-sm text-gray-400 italic mb-4">
                    No description
                </p>
            )}

            {/* Footer — date + member/file counts from _count */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                    Created {createdDate}
                </p>
                {/* _count is optional — only render if backend sent it */}
                {team._count && (
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>
                            {team._count.members}{' '}
                            {team._count.members === 1 ? 'member' : 'members'}
                        </span>
                        <span>
                            {team._count.files}{' '}
                            {team._count.files === 1 ? 'file' : 'files'}
                        </span>
                    </div>
                )}
            </div>
        </button>
    )
}

// ─── MAIN PAGE COMPONENT ───────────────────────────────────────────────────

export default function TeamList() {
    const navigate = useNavigate()

    // React Query fetches and caches the teams list.
    // queryKey: ['teams'] — cache identifier.
    // After creating a team we invalidate this key → auto re-fetch.
    const {
        data: teams,
        isLoading,
        isError,
        error,
        refetch,
    } = useQuery({
        queryKey: ['teams'],
        queryFn: fetchTeams,
    })

    // ── Loading state ─────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="p-6 max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <div className="h-7 bg-gray-200 rounded w-32 mb-2 animate-pulse" />
                        <div className="h-4 bg-gray-100 rounded w-48 animate-pulse" />
                    </div>
                    <div className="h-9 bg-gray-200 rounded-lg w-32 animate-pulse" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map((n) => <SkeletonCard key={n} />)}
                </div>
            </div>
        )
    }

    // ── Error state ───────────────────────────────────────────────────────────

    if (isError) {
        const message = error instanceof Error
            ? error.message
            : 'Failed to load teams'

        return (
            <div className="p-6 max-w-5xl mx-auto">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                    <p className="text-red-700 font-medium mb-1">Could not load teams</p>
                    <p className="text-red-500 text-sm mb-4">{message}</p>
                    <button
                        onClick={() => void refetch()}
                        className="text-sm text-red-600 hover:underline font-medium"
                    >
                        Try again
                    </button>
                </div>
            </div>
        )
    }

    // ── Empty state ───────────────────────────────────────────────────────────

    if (!teams || teams.length === 0) {
        return (
            <div className="p-6 max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">My Teams</h2>
                        <p className="text-sm text-gray-500 mt-0.5">
                            Your collaborative workspaces
                        </p>
                    </div>
                </div>
                <div className="bg-white border border-dashed border-gray-200 rounded-xl p-12 text-center">
                    <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-7 h-7 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                        </svg>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 mb-1">
                        No teams yet
                    </h3>
                    <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
                        Create your first team to start collaborating and sharing files.
                    </p>
                    <button
                        onClick={() => navigate('/teams/create')}
                        className="
              inline-flex items-center gap-2 px-4 py-2 rounded-lg
              bg-blue-600 text-white text-sm font-medium
              hover:bg-blue-700 transition-colors
            "
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Create your first team
                    </button>
                </div>
            </div>
        )
    }

    // ── Teams grid ────────────────────────────────────────────────────────────

    return (
        <div className="p-6 max-w-5xl mx-auto">

            {/* Page header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">My Teams</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {teams.length} {teams.length === 1 ? 'team' : 'teams'}
                    </p>
                </div>
                <button
                    onClick={() => navigate('/teams/create')}
                    className="
            inline-flex items-center gap-2 px-4 py-2 rounded-lg
            bg-blue-600 text-white text-sm font-medium
            hover:bg-blue-700
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            transition-colors
          "
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    New team
                </button>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {teams.map((team) => (
                    <TeamCard
                        key={team.id}
                        team={team}
                        onClick={() => navigate(`/teams/${team.id}`)}
                    />
                ))}
            </div>

        </div>
    )
}