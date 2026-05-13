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
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'
import type { TeamMember, TeamRole } from '@/types'
import type { ActivityLog } from '@/api/teams'
import {
    fetchTeam, fetchTeamMembers, fetchTeamActivity,
    generateTeamDigest
} from '@/api/teams'
import { ACTION_SENTENCES } from './ActivityFeed'
import { fetchAnnouncements, type Announcement } from '@/api/announcements'
import AnnouncementCard from '@/components/AnnouncementCard'
import AnnouncementModal from '@/components/AnnouncementModal'
import InviteBox from '@/components/InviteBox'

// ─── HELPERS ───────────────────────────────────────────────────────────────
function getMemberName(user?: { full_name?: string | null; username?: string }): string {
    return user?.full_name?.trim() || user?.username || 'Unknown'
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

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
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
    // Extract the target name using the same robust check as ActivityFeed
    const metadata = (activity.metadata ?? {}) as Record<string, unknown>
    const targetName = String(
        metadata.file_name ??
        metadata.folder_name ??
        metadata.oldName ??       // for renames
        metadata.name ??          // legacy
        `item #${activity.target_id ?? '?'}`
    )

    // Lookup the clean sentence ("started editing", "uploaded", etc.)
    const sentence = ACTION_SENTENCES[activity.action] ?? activity.action.replace(/_/g, ' ')

    return (
        <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
            {/* User avatar */}
            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 mt-0.5 border border-blue-200">
                <span className="text-xs font-bold">
                    {getMemberName(activity.user).charAt(0).toUpperCase()}
                </span>
            </div>

            {/* Event description */}
            <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 leading-snug">
                    <span className="font-bold">{getMemberName(activity.user)}</span>
                    {' '}
                    <span className="text-gray-600">{sentence}</span>{' '}
                    <span className="font-semibold text-blue-700">'{targetName}'</span>
                </p>
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

    // Controls the announcement modal
    // null = closed, undefined = create mode, Announcement = edit mode
    const [announcementModal, setAnnouncementModal] = useState<
        'closed' | 'create' | Announcement
    >('closed')

    // Fetch announcements — separate query from team/members
    const announcementsQuery = useQuery({
        queryKey: ['announcements', teamId],
        queryFn: () => fetchAnnouncements(teamId),
        enabled: teamId > 0,
    })

    const announcements = announcementsQuery.data ?? []

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



    // ─── AI DIGEST PANEL ──────────────────────────────────────────────────────
    function DigestPanel({ teamId }: { teamId: number }) {
        const [digest, setDigest] = useState<string | null>(null)
        const [fromCache, setFromCache] = useState(false)
        const [isLoading, setIsLoading] = useState(false)

        const handleGenerate = async () => {
            setIsLoading(true)
            try {
                const result = await generateTeamDigest(teamId)
                setDigest(result.digest)
                setFromCache(result.fromCache)

                if (result.fromCache) {
                    toast('Showing cached digest ⚡ — refreshes every 6 hours', { duration: 4000 })
                } else {
                    toast.success('AI digest generated ✨')
                }
            } catch (err: any) {
                toast.error(err.response?.data?.error ?? 'Failed to generate digest')
            } finally {
                setIsLoading(false)
            }
        }

        return (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        {/* Sparkle icon */}
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                            />
                        </svg>
                        <h2 className="text-base font-semibold text-gray-900">AI Weekly Digest</h2>
                    </div>
                    {fromCache && (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            cached
                        </span>
                    )}
                </div>

                {!digest ? (
                    <div className="text-center py-6">
                        <p className="text-sm text-gray-500 mb-4">
                            Get an AI-generated summary of your team's activity from the last 7 days.
                        </p>
                        <button
                            onClick={() => void handleGenerate()}
                            disabled={isLoading}
                            className="
              inline-flex items-center gap-2 px-5 py-2.5
              bg-purple-600 hover:bg-purple-700 text-white 
              text-sm font-semibold rounded-lg transition-colors
              disabled:opacity-50 shadow-sm
            "
                        >
                            {isLoading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                                        />
                                    </svg>
                                    Generate AI Digest
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    <div>
                        {/* Digest text */}
                        <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 mb-3 max-h-64 overflow-y-auto">
                            {/* 
                                max-h-64 = 256px max height before scrolling
                                overflow-y-auto = scroll if content overflows
                                whitespace-pre-wrap = respect paragraph breaks from AI
                                leading-relaxed = comfortable line height for reading
                            */}
                            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                                {digest}
                            </p>
                        </div>

                        {/* Actions row */}
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => {
                                    void navigator.clipboard.writeText(digest)
                                    toast.success('Digest copied to clipboard')
                                }}
                                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                </svg>
                                Copy
                            </button>

                            {/* Regenerate — always force-refreshes (bypasses cache) */}
                            <button
                                onClick={async () => {
                                    setIsLoading(true)
                                    try {
                                        const result = await generateTeamDigest(teamId, true)
                                        setDigest(result.digest)
                                        setFromCache(false)
                                        toast.success('Fresh digest generated ✨')
                                    } catch (err: any) {
                                        toast.error(err.response?.data?.error ?? 'Failed to regenerate')
                                    } finally {
                                        setIsLoading(false)
                                    }
                                }}
                                disabled={isLoading}
                                className="text-xs text-purple-600 hover:text-purple-800 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
                                title="Force-regenerate digest (bypasses cache)"
                            >
                                {isLoading ? 'Generating...' : '↻ Regenerate'}
                            </button>
                        </div>
                    </div>
                )}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">

                {/* Files stat */}
                <StatCard
                    icon={
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                            />
                        </svg>
                    }
                    label="Items"
                    value={(team._count?.files ?? 0) + (team._count?.documents ?? 0)}
                    actionLabel="Browse files"
                    onAction={() => navigate(`/teams/${teamId}/files`)}
                />

                {/* CloudTeams Documents stat (Day 2 Collaborative Editor) */}




                <StatCard
                    icon={
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8 4s8 1.79 8 4"
                            />
                        </svg>
                    }
                    label="Storage Used"
                    value={formatBytes(team._count?.totalBytes ?? 0)}
                    actionLabel="View analytics"
                    onAction={() => navigate(`/teams/${teamId}/analytics`)}
                />

            </div>

            {/* Invite code box — admins only */}
            {isAdmin && (
                <div className="mb-6">
                    <InviteBox teamId={teamId} isAdmin={isAdmin} />
                </div>
            )}

            {/* ── Bottom multi-column section ───────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* AI Digest Panel — available to all members */}
                <DigestPanel teamId={teamId} />

                {/* Announcements panel */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-semibold text-gray-900">Announcements</h2>
                        {/* Post New — only visible to admins */}
                        {isAdmin && (
                            <button
                                onClick={() => setAnnouncementModal('create')}
                                className="text-sm text-blue-600 hover:underline font-medium"
                            >
                                Post New
                            </button>
                        )}
                    </div>

                    {/* Loading state */}
                    {announcementsQuery.isLoading ? (
                        <div className="space-y-3 animate-pulse">
                            {[1, 2].map(n => (
                                <div key={n} className="h-24 bg-gray-100 rounded-lg" />
                            ))}
                        </div>

                    ) : announcements.length === 0 ? (
                        /* Empty state */
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                            <svg className="w-10 h-10 text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                    d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                                />
                            </svg>
                            <p className="text-sm font-semibold text-slate-700">No announcements yet</p>
                            <p className="text-xs text-slate-400 mt-1 px-4 leading-relaxed">
                                {isAdmin
                                    ? 'Post an announcement to share important updates with your team.'
                                    : 'Important updates shared by team admins will appear here.'
                                }
                            </p>
                            {/* CTA for admins inside empty state */}
                            {isAdmin && (
                                <button
                                    onClick={() => setAnnouncementModal('create')}
                                    className="mt-4 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    Post first announcement
                                </button>
                            )}
                        </div>

                    ) : (
                        /* Announcement list */
                        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                            {/*
                                max-h-80 + overflow-y-auto: if there are many announcements,
                                the panel scrolls internally rather than pushing other panels down.
                                pr-1: small right padding so scrollbar doesn't overlap content.
                            */}
                            {announcements.map(announcement => (
                                <AnnouncementCard
                                    key={announcement.id}
                                    announcement={announcement}
                                    teamId={teamId}
                                    currentUserId={user?.id ?? 0}
                                    isAdmin={isAdmin}
                                    onEdit={(a) => setAnnouncementModal(a)}
                                />
                            ))}
                        </div>
                    )}
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

            {/* Announcement modal — create or edit */}
            {announcementModal !== 'closed' && (
                <AnnouncementModal
                    teamId={teamId}
                    existing={typeof announcementModal === 'object' ? announcementModal : undefined}
                    isAdmin={isAdmin}
                    onClose={() => setAnnouncementModal('closed')}
                />
            )}
        </div>
    )
}