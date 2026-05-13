// src/pages/Members.tsx
//
// PURPOSE: Dedicated page to view and manage team members.
//          Shows detailed member info: full name, job title, email, role, and join date.
//          Includes search and filtering functionality.
//
// DESIGN: Clean, professional table layout with status indicators and quick actions.

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTeam, fetchTeamMembers } from '../api/teams'
import type { TeamMember, TeamRole } from '../types'
import { useAuth } from '../hooks/useAuth'

// ─── HELPERS ───────────────────────────────────────────────────────────────

function getMemberName(member: TeamMember): string {
    return member.user.full_name?.trim() || member.user.username || 'Unknown'
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    })
}

// Role badge — standardized with other pages
function RoleBadge({ role }: { role: TeamRole }) {
    const styles: Record<TeamRole, string> = {
        admin: 'bg-purple-100 text-purple-700 border-purple-200',
        editor: 'bg-blue-100 text-blue-700 border-blue-200',
        viewer: 'bg-gray-100 text-gray-600 border-gray-200',
    }
    return (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[role]}`}>
            {role.charAt(0).toUpperCase() + role.slice(1)}
        </span>
    )
}

export default function Members() {
    const { id } = useParams()
    const teamId = parseInt(id || '0', 10)
    const navigate = useNavigate()
    const { user: currentUser } = useAuth()
    const [searchQuery, setSearchQuery] = useState('')

    // ─── DATA FETCHING ───────────────────────────────────────────────────────

    // 1. Fetch basic team info (for name in header)
    const { data: team } = useQuery({
        queryKey: ['team', teamId],
        queryFn: () => fetchTeam(teamId),
        enabled: !!teamId
    })

    // 2. Fetch full member list
    const { data: members = [], isLoading } = useQuery({
        queryKey: ['team-members', teamId],
        queryFn: () => fetchTeamMembers(teamId),
        enabled: !!teamId
    })

    // ─── LOGIC ───────────────────────────────────────────────────────────────

    // Filter members based on search query
    const filteredMembers = members.filter(m => {
        const name = getMemberName(m).toLowerCase()
        const email = m.user.email.toLowerCase()
        const job = (m.user.job_title || '').toLowerCase()
        const query = searchQuery.toLowerCase()
        return name.includes(query) || email.includes(query) || job.includes(query)
    })

    const isAdmin = team?.myRole === 'admin'

    // ─── RENDER ──────────────────────────────────────────────────────────────

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            {/* Header section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <nav className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                        <button onClick={() => navigate(`/teams/${teamId}`)} className="hover:text-blue-600 transition-colors">
                            {team?.name || 'Dashboard'}
                        </button>
                        <span>/</span>
                        <span className="text-gray-900 font-medium">Members</span>
                    </nav>
                    <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
                    <p className="text-gray-600 mt-1">Manage and view everyone in your workspace.</p>
                </div>

                <div className="flex items-center gap-3">
                    {isAdmin && (
                        <button
                            onClick={() => navigate(`/teams/${teamId}/invite`)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                            </svg>
                            Invite Member
                        </button>
                    )}
                </div>
            </div>

            {/* Search & Filter Bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 shadow-sm">
                <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <input
                        type="text"
                        placeholder="Search by name, email, or job title..."
                        className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* Members Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Member
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Role
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Job Title
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Joined Date
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Status
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {isLoading ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                                                <div className="space-y-2">
                                                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                                                    <div className="h-3 bg-gray-200 rounded w-32"></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td colSpan={4} className="px-6 py-4">
                                            <div className="h-4 bg-gray-100 rounded w-full"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : filteredMembers.length > 0 ? (
                                filteredMembers.map((member) => (
                                    <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="h-10 w-10 flex-shrink-0">
                                                    <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                                                        {getMemberName(member).charAt(0).toUpperCase()}
                                                    </div>
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-medium text-gray-900">
                                                        {getMemberName(member)}
                                                        {member.user_id === currentUser?.id && (
                                                            <span className="ml-2 text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded uppercase tracking-wider">You</span>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-gray-500">{member.user.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <RoleBadge role={member.role} />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {member.user.job_title || '—'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {formatDate(member.created_at)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                {(() => {
                                                    const lastLogin = member.user.last_login
                                                    if (!lastLogin) return (
                                                        <>
                                                            <span className="flex h-2 w-2 rounded-full bg-gray-300"></span>
                                                            <span className="text-xs font-medium text-gray-500">Never</span>
                                                        </>
                                                    )

                                                    const date = new Date(lastLogin)
                                                    const now = new Date()
                                                    const diffMs = now.getTime() - date.getTime()
                                                    const isOnline = diffMs < 5 * 60 * 1000 // 5 minutes

                                                    if (isOnline) return (
                                                        <>
                                                            <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                                                            <span className="text-xs font-medium text-green-700">Active</span>
                                                        </>
                                                    )

                                                    // Format relative time for "Last seen"
                                                    const diffMin = Math.floor(diffMs / 60000)
                                                    const diffHr = Math.floor(diffMin / 60)
                                                    const diffDay = Math.floor(diffHr / 24)

                                                    let timeStr = ''
                                                    if (diffDay > 0) timeStr = `${diffDay}d ago`
                                                    else if (diffHr > 0) timeStr = `${diffHr}h ago`
                                                    else timeStr = `${diffMin}m ago`

                                                    return (
                                                        <>
                                                            <span className="flex h-2 w-2 rounded-full bg-gray-400"></span>
                                                            <span className="text-xs font-medium text-gray-500">Seen {timeStr}</span>
                                                        </>
                                                    )
                                                })()}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center">
                                        <div className="text-gray-400 mb-2">
                                            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                            </svg>
                                        </div>
                                        <p className="text-gray-500 font-medium">No members found matching your search</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                    <p className="text-sm font-medium text-blue-600 mb-1">Total Members</p>
                    <p className="text-2xl font-bold text-blue-900">{members.length}</p>
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-5">
                    <p className="text-sm font-medium text-purple-600 mb-1">Admins</p>
                    <p className="text-2xl font-bold text-purple-900">{members.filter(m => m.role === 'admin').length}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                    <p className="text-sm font-medium text-gray-600 mb-1">Editors/Viewers</p>
                    <p className="text-2xl font-bold text-gray-900">{members.filter(m => m.role !== 'admin').length}</p>
                </div>
            </div>
        </div>
    )
}
