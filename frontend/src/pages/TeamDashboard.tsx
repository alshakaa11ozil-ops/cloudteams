// src/pages/TeamDashboard.tsx
//
// PURPOSE: Landing page for a specific team.
//          Shows team info, members preview, recent activity, and quick actions.
//          Uses parallel React Query calls for fast loading.
//
// INPUTS:  :id from URL params (e.g. /teams/3 → teamId = 3)
// OUTPUTS: Team dashboard with stats, members, activity

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import type { TeamMember, TeamRole } from '@/types'
import type { ActivityLog } from '@/api/teams'
import { fetchTeam, fetchTeamMembers, fetchTeamActivity, getInviteCode, regenerateInviteCode } from '@/api/teams'

// ─── HELPERS ───────────────────────────────────────────────────────────────
function getMemberName(user?: { name?: string; username?: string }): string {
    return user?.name ?? user?.username ?? 'Unknown'
}
// Convert an action string like "file_uploaded" → "File uploaded"
// Used in the activity feed to show human-readable event names.
function formatAction(action: string): string {
    return action
        .split('_')                          // ["file", "uploaded"]
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))  // ["File", "Uploaded"]
        .join(' ')                           // "File Uploaded"
}

// Format a timestamp as a relative time string.
// "2 hours ago", "3 days ago", etc.
// WHY: Absolute timestamps ("2026-04-10 14:30") are less readable
// than relative ones in an activity feed context.
function timeAgo(dateString: string): string {
    const date = new Date(dateString)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
}

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

// Role badge — same pattern as TeamList
function RoleBadge({ role }: { role: TeamRole | undefined }) {
    const styles: Record<string, string> = {
        admin: 'bg-purple-100 text-purple-700',
        editor: 'bg-blue-100 text-blue-700',
        viewer: 'bg-gray-100 text-gray-600',
    }
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

// Stat card — shows a number + label + optional action button
function StatCard({
    icon,
    label,
    value,
    actionLabel,
    onAction,
}: {
    icon: React.ReactNode
    label: string
    value: number | string
    actionLabel?: string
    onAction?: () => void
}) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-3">
                {/* Icon container */}
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    {icon}
                </div>
                <span className="text-sm font-medium text-gray-600">{label}</span>
            </div>
            <p className="text-2xl font-semibold text-gray-900 mb-3">{value}</p>
            {actionLabel && onAction && (
                <button
                    onClick={onAction}
                    className="text-sm text-blue-600 hover:underline font-medium"
                >
                    {actionLabel} →
                </button>
            )}
        </div>
    )
}

// Member avatar row — shows up to 5 members with overflow count
function MemberAvatarRow({ members }: { members: TeamMember[] }) {
    const visible = members.slice(0, 5)
    const overflow = members.length - visible.length

    return (
        <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
                {visible.map((member) => (
                    <div
                        key={member.id}
                        // Each avatar overlaps the previous by -space-x-2
                        className="
              w-8 h-8 rounded-full bg-blue-600 border-2 border-white
              flex items-center justify-center flex-shrink-0
            "
                        title={getMemberName(member.user)}
                    >
                        <span className="text-xs font-semibold text-white">
                            {getMemberName(member.user).charAt(0).toUpperCase()}
                        </span>
                    </div>
                ))}
            </div>
            {/* Show "+N more" if there are more than 5 members */}
            {overflow > 0 && (
                <span className="text-xs text-gray-500">+{overflow} more</span>
            )}
        </div>
    )
}

// Activity item — one row in the activity feed
function ActivityItem({ activity }: { activity: ActivityLog }) {
    return (
        <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
            {/* User avatar */}
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-medium text-gray-600">
                    {getMemberName(activity.user).charAt(0).toUpperCase()}
                </span>
            </div>

            {/* Event description */}
            <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">
                    <span className="font-medium">{getMemberName(activity.user)}</span>
                    {' '}
                    <span className="text-gray-600">
                        {formatAction(activity.action).toLowerCase()}
                    </span>
                </p>
                {/* Show metadata if available — e.g. filename */}
                {activity.metadata && typeof activity.metadata === 'object' && (
                    'filename' in activity.metadata ||
                    'name' in activity.metadata
                ) && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                            {String(
                                (activity.metadata as Record<string, unknown>).filename ??
                                (activity.metadata as Record<string, unknown>).name ??
                                ''
                            )}
                        </p>
                    )}
            </div>

            {/* Timestamp */}
            <span className="text-xs text-gray-400 flex-shrink-0">
                {timeAgo(activity.created_at)}
            </span>
        </div>
    )
}

// ─── SKELETON ──────────────────────────────────────────────────────────────

function DashboardSkeleton() {
    return (
        <div className="p-6 max-w-5xl mx-auto animate-pulse">
            {/* Header skeleton */}
            <div className="mb-8">
                <div className="h-4 bg-gray-200 rounded w-24 mb-4" />
                <div className="h-8 bg-gray-200 rounded w-64 mb-2" />
                <div className="h-4 bg-gray-100 rounded w-96" />
            </div>
            {/* Stat cards skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {[1, 2, 3].map(n => (
                    <div key={n} className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="h-9 w-9 bg-gray-200 rounded-lg mb-3" />
                        <div className="h-7 bg-gray-200 rounded w-16 mb-2" />
                        <div className="h-4 bg-gray-100 rounded w-24" />
                    </div>
                ))}
            </div>
        </div>
    )
}



// ─── MAIN COMPONENT ────────────────────────────────────────────────────────

export default function TeamDashboard() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { user } = useAuth()

    // Parse the team ID from the URL.
    // useParams always returns strings — parseInt converts to number.
    // WHY parseInt with radix 10: prevents octal parsing of strings
    // starting with 0 in older JS environments.
    const teamId = parseInt(id ?? '0', 10)

    // ── Parallel queries ──────────────────────────────────────────────────────
    //
    // Three useQuery calls fire simultaneously — not sequentially.
    // React Query sees three independent queries and runs them in parallel.
    // Total wait time = slowest query, not sum of all queries.

    const teamQuery = useQuery({
        queryKey: ['team', teamId],    // scoped to this specific team
        queryFn: () => fetchTeam(teamId),
        enabled: teamId > 0,           // don't fetch if teamId is invalid
    })

    const membersQuery = useQuery({
        queryKey: ['team-members', teamId],
        queryFn: () => fetchTeamMembers(teamId),
        enabled: teamId > 0,
    })

    const activityQuery = useQuery({
        queryKey: ['team-activity', teamId],
        queryFn: () => fetchTeamActivity(teamId, 5),
        enabled: teamId > 0,
    })

    // ── Loading state ─────────────────────────────────────────────────────────
    //
    // Show skeleton only while the TEAM query is loading.
    // Members and activity have their own loading states below.
    // WHY: Team name/description is the most important — show it first.
    // Members and activity can load progressively below.

    if (teamQuery.isLoading) {
        return <DashboardSkeleton />
    }

    // ── Error / not found ─────────────────────────────────────────────────────

    if (teamQuery.isError || !teamQuery.data) {
        return (
            <div className="p-6 max-w-5xl mx-auto">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                    <p className="text-red-700 font-medium mb-2">Team not found</p>
                    <p className="text-red-500 text-sm mb-4">
                        This team may have been deleted or you don't have access.
                    </p>
                    <button
                        onClick={() => navigate('/teams')}
                        className="text-sm text-red-600 hover:underline font-medium"
                    >
                        ← Back to teams
                    </button>
                </div>
            </div>
        )
    }

    const team = teamQuery.data
    const members = membersQuery.data ?? []
    const activities = activityQuery.data ?? []

    // Determine current user's role in this team.
    // team.myRole comes from the GET /teams/:id response.
    // WHY NEEDED: We use this to show/hide the invite button.
    const myRole = team.myRole
    const isAdmin = myRole === 'admin'
    const isOwner = team.owner_id === user?.id

    // ─── INVITE CODE PANEL ─────────────────────────────────────────────────────
    // Only rendered for admins — shows current code, copy button, regenerate button

    function InviteCodePanel({ teamId }: { teamId: number }) {
        const queryClient = useQueryClient()
        const [copied, setCopied] = useState(false)

        const { data, isLoading } = useQuery({
            queryKey: ['invite-code', teamId],
            queryFn: () => getInviteCode(teamId),
        })

        const regenerateMutation = useMutation({
            mutationFn: () => regenerateInviteCode(teamId),
            onSuccess: () => {
                // Invalidate so the code panel re-fetches the new code
                void queryClient.invalidateQueries({ queryKey: ['invite-code', teamId] })
            },
        })

        const handleCopy = async (type: 'code' | 'link') => {
            if (!data?.code) return
            const text = type === 'code'
                ? data.code
                : `${window.location.origin}/join/${data.code}`
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }

        if (isLoading) {
            return (
                <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
                    <div className="h-10 bg-gray-100 rounded" />
                </div>
            )
        }

        return (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-1">
                    Team invite code
                </h2>
                <p className="text-xs text-gray-500 mb-4">
                    Share this code or link to invite people to your team.
                    Regenerating it immediately invalidates the old one.
                </p>

                {/* Code display */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between mb-3">
                    <span className="text-2xl font-mono font-bold text-gray-900 tracking-widest">
                        {data?.code ?? '--------'}
                    </span>
                    <button
                        onClick={() => void handleCopy('code')}
                        className="text-sm text-blue-600 hover:underline font-medium ml-4 flex-shrink-0"
                    >
                        {copied ? 'Copied! ✓' : 'Copy code'}
                    </button>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                    <button
                        onClick={() => void handleCopy('link')}
                        className="
            flex-1 py-2 px-3 rounded-lg text-xs font-medium
            border border-gray-300 text-gray-700
            hover:bg-gray-50 transition-colors
          "
                    >
                        Copy invite link
                    </button>
                    <button
                        onClick={() => regenerateMutation.mutate()}
                        disabled={regenerateMutation.isPending}
                        className="
            flex-1 py-2 px-3 rounded-lg text-xs font-medium
            border border-red-200 text-red-600
            hover:bg-red-50 transition-colors
            disabled:opacity-50
          "
                    >
                        {regenerateMutation.isPending ? 'Regenerating...' : 'Regenerate code'}
                    </button>
                </div>
            </div>
        )
    }

    // ─── RENDER ──────────────────────────────────────────────────────────────

    return (
        <div className="p-6 max-w-5xl mx-auto">

            {/* ── Page header ────────────────────────────────────────────────── */}
            <div className="mb-8">
                {/* Breadcrumb */}
                <button
                    onClick={() => navigate('/teams')}
                    className="
            inline-flex items-center gap-1.5 text-sm text-gray-500
            hover:text-gray-900 transition-colors mb-4
          "
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M10 19l-7-7m0 0l7-7m-7 7h18"
                        />
                    </svg>
                    All teams
                </button>

                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h1 className="text-2xl font-semibold text-gray-900">
                                {team.name}
                            </h1>
                            <RoleBadge role={myRole} />
                            {/* Owner crown — visual indicator they created this team */}
                            {isOwner && (
                                <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                                    Owner
                                </span>
                            )}
                        </div>
                        {team.description ? (
                            <p className="text-sm text-gray-500 max-w-xl">
                                {team.description}
                            </p>
                        ) : (
                            <p className="text-sm text-gray-400 italic">No description</p>
                        )}
                    </div>

                    {/* Invite button — only admins can invite */}
                    {isAdmin && (
                        <button
                            onClick={() => navigate(`/teams/${teamId}/invite`)}
                            className="
                inline-flex items-center gap-2 px-4 py-2 rounded-lg
                bg-blue-600 text-white text-sm font-medium flex-shrink-0
                hover:bg-blue-700
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                transition-colors
              "
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                                />
                            </svg>
                            Invite member
                        </button>
                    )}
                </div>
            </div>

            {/* ── Stat cards ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">

                {/* Files stat */}
                <StatCard
                    icon={
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                            />
                        </svg>
                    }
                    label="Files"
                    value={team._count?.files ?? 0}
                    actionLabel="Browse files"
                    onAction={() => navigate(`/teams/${teamId}/files`)}
                />

                {/* Members stat */}
                <StatCard
                    icon={
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                        </svg>
                    }
                    label="Members"
                    value={team._count?.members ?? members.length}
                    actionLabel="View all members"
                    onAction={() => navigate(`/teams/${teamId}/members`)}
                />

                {/* Storage stat — placeholder value for now */}
                <StatCard
                    icon={
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8 4s8 1.79 8 4"
                            />
                        </svg>
                    }
                    label="Storage"
                    value="—"
                    actionLabel="View analytics"
                    onAction={() => navigate(`/teams/${teamId}/analytics`)}
                />

            </div>
            {/* Invite code panel — admins only */}
            {isAdmin && (
                <div className="mb-6">
                    <InviteCodePanel teamId={teamId} />
                </div>
            )}

            {/* ── Bottom multi-column section ───────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Announcements panel */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-semibold text-gray-900">Announcements</h2>
                        {isAdmin && (
                            <button className="text-sm text-blue-600 hover:underline font-medium">
                                Post New
                            </button>
                        )}
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                        <svg className="w-10 h-10 text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                        </svg>
                        <p className="text-sm font-semibold text-slate-700">No announcements yet</p>
                        <p className="text-xs text-slate-400 mt-1 px-4 leading-relaxed">Important updates and links shared by team admins will appear here.</p>
                    </div>
                </div>

                {/* Members panel */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-semibold text-gray-900">Members</h2>
                        <button
                            onClick={() => navigate(`/teams/${teamId}/members`)}
                            className="text-sm text-blue-600 hover:underline"
                        >
                            View all
                        </button>
                    </div>

                    {membersQuery.isLoading ? (
                        // Members loading state
                        <div className="space-y-3 animate-pulse">
                            {[1, 2, 3].map(n => (
                                <div key={n} className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-gray-200" />
                                    <div className="flex-1">
                                        <div className="h-4 bg-gray-200 rounded w-32 mb-1" />
                                        <div className="h-3 bg-gray-100 rounded w-48" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : members.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">
                            No members yet
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {/* Show first 5 members */}
                            {members.slice(0, 5).map((member) => (
                                <div key={member.id} className="flex items-center gap-3">
                                    {/* Avatar */}
                                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                                        <span className="text-xs font-semibold text-white">
                                            {getMemberName(member.user).charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                    {/* Name + email */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">
                                            {getMemberName(member.user)}
                                        </p>
                                        <p className="text-xs text-gray-400 truncate">
                                            {member.user?.email ?? ''}
                                        </p>
                                    </div>
                                    {/* Role badge */}
                                    <RoleBadge role={member.role} />
                                </div>
                            ))}
                            {/* Overflow indicator */}
                            {members.length > 5 && (
                                <div className="pt-2 border-t border-gray-100">
                                    <MemberAvatarRow members={members.slice(5)} />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Activity panel */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-semibold text-gray-900">
                            Recent activity
                        </h2>
                        <button
                            onClick={() => navigate(`/teams/${teamId}/activity`)}
                            className="text-sm text-blue-600 hover:underline"
                        >
                            View all
                        </button>
                    </div>

                    {activityQuery.isLoading ? (
                        // Activity loading state
                        <div className="space-y-3 animate-pulse">
                            {[1, 2, 3].map(n => (
                                <div key={n} className="flex items-start gap-3 py-3 border-b border-gray-100">
                                    <div className="w-7 h-7 rounded-full bg-gray-200" />
                                    <div className="flex-1">
                                        <div className="h-4 bg-gray-200 rounded w-3/4 mb-1" />
                                        <div className="h-3 bg-gray-100 rounded w-1/2" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : activities.length === 0 ? (
                        <div className="py-8 text-center">
                            <p className="text-sm text-gray-400">No activity yet</p>
                            <p className="text-xs text-gray-400 mt-1">
                                Activity will appear here when team members upload files or make changes.
                            </p>
                        </div>
                    ) : (
                        <div>
                            {activities.map((activity) => (
                                <ActivityItem key={activity.id} activity={activity} />
                            ))}
                        </div>
                    )}
                </div>

            </div>
        </div>
    )
}