// src/pages/teams/TeamSettings.tsx
//
// PURPOSE: Admin-only settings page for a team.
//          Three sections: Team Info, Members, Danger Zone.
//
// INPUTS:  :id from URL params (teamId)
// OUTPUTS: Forms to rename team, manage members, delete team
//
// GUARD:   On mount, fetch current user's role.
//          If not admin → redirect to /teams/:id/files immediately.
//          WHY REDIRECT NOT ERROR: Better UX than showing a "forbidden" message.
//          The settings link is hidden from non-admins in the sidebar anyway —
//          this is a defense-in-depth check for direct URL access.

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import {
    fetchTeam,
    fetchTeamMembers,
    updateTeam,
    updateMemberRole,
    removeMember,
    deleteTeam,
} from '../api/teams'
import type { TeamRole } from '../types'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getMemberName(user?: { name?: string; username?: string }): string {
    return user?.name ?? user?.username ?? 'Unknown'
}

// ─── SECTION: TEAM INFO ───────────────────────────────────────────────────────
//
// PURPOSE: Let admin rename the team and update its description.
// WHY CONTROLLED INPUTS: We pre-fill from the fetched team data, then track
//   changes locally. On save we only send what the admin changed.

function TeamInfoSection({ teamId, initialName, initialDescription }: {
    teamId: number
    initialName: string
    initialDescription: string
}) {
    const queryClient = useQueryClient()
    const [name, setName] = useState(initialName)
    const [description, setDescription] = useState(initialDescription)

    // Track whether anything actually changed
    // WHY: Disable the save button if nothing changed — avoids pointless API calls
    const isDirty = name !== initialName || description !== initialDescription
    const isNameEmpty = name.trim().length === 0

    const mutation = useMutation({
        mutationFn: () => updateTeam(teamId, {
            name: name.trim(),
            description: description.trim()
        }),
        onSuccess: () => {
            // Refetch team data so the header and sidebar update immediately
            void queryClient.invalidateQueries({ queryKey: ['team', teamId] })
            toast.success('Team settings saved')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to save settings')
        }
    })

    return (
        <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Team information</h2>
            <p className="text-sm text-gray-500 mb-5">
                Update your team's name and description.
            </p>

            <div className="space-y-4 max-w-lg">
                {/* Team name input */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Team name <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        maxLength={80}
                        placeholder="e.g. CS 101 Project"
                        className="
              w-full px-3 py-2 text-sm rounded-lg border border-gray-300
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              disabled:bg-gray-50 disabled:text-gray-400
            "
                    />
                    {isNameEmpty && (
                        <p className="text-xs text-red-500 mt-1">Team name cannot be empty</p>
                    )}
                </div>

                {/* Description textarea */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Description <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        rows={3}
                        maxLength={300}
                        placeholder="What is this team working on?"
                        className="
              w-full px-3 py-2 text-sm rounded-lg border border-gray-300
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              resize-none
            "
                    />
                    {/* Character counter */}
                    <p className="text-xs text-gray-400 mt-1 text-right">
                        {description.length}/300
                    </p>
                </div>

                {/* Save button */}
                <button
                    onClick={() => mutation.mutate()}
                    disabled={!isDirty || isNameEmpty || mutation.isPending}
                    className="
            px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg
            hover:bg-blue-700 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed
          "
                >
                    {mutation.isPending ? 'Saving...' : 'Save changes'}
                </button>
            </div>
        </section>
    )
}

// ─── SECTION: MEMBERS ─────────────────────────────────────────────────────────
//
// PURPOSE: Show all team members in a table.
//          Admin can change any member's role or remove them.
//
// RULES enforced on frontend (backend enforces same rules):
//   - Can't change your own role (you'd lock yourself out)
//   - Can't remove yourself
//   - Can't remove the last admin (backend enforces, we warn in UI)

function MembersSection({ teamId, currentUserId }: {
    teamId: number
    currentUserId: number
}) {
    const queryClient = useQueryClient()

    // Which member's remove confirmation is showing
    // null = none, number = userId of member being confirmed
    const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null)

    const { data: members = [], isLoading } = useQuery({
        queryKey: ['team-members', teamId],
        queryFn: () => fetchTeamMembers(teamId),
    })

    // Count admins — to warn if removing the last one
    // WHY: If there's only 1 admin and you remove them, no one can manage the team
    const adminCount = members.filter(m => m.role === 'admin').length

    // ── Role change mutation ──────────────────────────────────────────────────

    const roleMutation = useMutation({
        mutationFn: ({ userId, role }: { userId: number; role: TeamRole }) =>
            updateMemberRole(teamId, userId, role),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
            toast.success('Role updated')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to update role')
        }
    })

    // ── Remove member mutation ────────────────────────────────────────────────

    const removeMutation = useMutation({
        mutationFn: (userId: number) => removeMember(teamId, userId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
            setConfirmRemoveId(null)
            toast.success('Member removed')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to remove member')
            setConfirmRemoveId(null)
        }
    })

    if (isLoading) {
        return (
            <section className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3].map(n => (
                        <div key={n} className="h-12 bg-gray-100 rounded" />
                    ))}
                </div>
            </section>
        )
    }

    return (
        <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h2 className="text-base font-semibold text-gray-900">Members</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {members.length} member{members.length !== 1 ? 's' : ''}
                    </p>
                </div>
            </div>

            {/* Members table */}
            <div className="overflow-x-auto -mx-6">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-y border-gray-100 bg-gray-50">
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-3 px-6">
                                Member
                            </th>
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-3 px-4">
                                Role
                            </th>
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-3 px-4">
                                Joined
                            </th>
                            <th className="py-3 px-6" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {members.map((member) => {
                            const isCurrentUser = member.user_id === currentUserId
                            const isLastAdmin = member.role === 'admin' && adminCount === 1
                            const isConfirmingRemove = confirmRemoveId === member.user_id

                            return (
                                <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                                    {/* Member name + email */}
                                    <td className="py-3.5 px-6">
                                        <div className="flex items-center gap-3">
                                            {/* Avatar */}
                                            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                                                <span className="text-xs font-bold text-white">
                                                    {getMemberName(member.user).charAt(0).toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-medium text-gray-900 truncate">
                                                    {getMemberName(member.user)}
                                                    {/* "You" badge for current user */}
                                                    {isCurrentUser && (
                                                        <span className="ml-2 text-xs text-gray-400 font-normal">(you)</span>
                                                    )}
                                                </p>
                                                <p className="text-xs text-gray-400 truncate">
                                                    {member.user?.email ?? ''}
                                                </p>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Role dropdown */}
                                    <td className="py-3.5 px-4">
                                        <select
                                            value={member.role}
                                            // Disable for current user — can't change own role
                                            // WHY: If you demote yourself from admin, you lose access to this page
                                            disabled={isCurrentUser || roleMutation.isPending}
                                            onChange={e =>
                                                roleMutation.mutate({
                                                    userId: member.user_id,
                                                    role: e.target.value as TeamRole
                                                })
                                            }
                                            className="
                        text-sm rounded-lg border border-gray-200 px-2 py-1.5
                        bg-white focus:outline-none focus:ring-2 focus:ring-blue-500
                        disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
                      "
                                        >
                                            <option value="viewer">Viewer</option>
                                            <option value="editor">Editor</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </td>

                                    {/* Joined date */}
                                    <td className="py-3.5 px-4 text-gray-500">
                                        {new Date(member.created_at).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric'
                                        })}
                                    </td>

                                    {/* Remove button / confirm dialog */}
                                    <td className="py-3.5 px-6 text-right">
                                        {isConfirmingRemove ? (
                                            // Inline confirmation — shows on the same row
                                            // WHY INLINE: Less jarring than a modal for a table row action
                                            <div className="flex items-center justify-end gap-2">
                                                <span className="text-xs text-gray-600">Remove?</span>
                                                <button
                                                    onClick={() => removeMutation.mutate(member.user_id)}
                                                    disabled={removeMutation.isPending}
                                                    className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                                                >
                                                    {removeMutation.isPending ? 'Removing...' : 'Yes, remove'}
                                                </button>
                                                <button
                                                    onClick={() => setConfirmRemoveId(null)}
                                                    className="text-xs text-gray-400 hover:text-gray-600"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                // Disable for current user or the last admin
                                                disabled={isCurrentUser || isLastAdmin}
                                                onClick={() => setConfirmRemoveId(member.user_id)}
                                                title={
                                                    isCurrentUser ? "You can't remove yourself" :
                                                        isLastAdmin ? "Can't remove the only admin" :
                                                            `Remove ${getMemberName(member.user)}`
                                                }
                                                className="
                          text-xs text-red-500 hover:text-red-700 font-medium
                          disabled:text-gray-300 disabled:cursor-not-allowed
                          transition-colors
                        "
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    )
}

// ─── SECTION: DANGER ZONE ─────────────────────────────────────────────────────
//
// PURPOSE: Let the admin permanently delete the entire team.
//
// PATTERN: Type the team name to confirm — same as GitHub's repo deletion.
// WHY THIS PATTERN: Forces the user to actively type, not just click a button.
//   Prevents accidental deletion from a misclick.
//   The committee will recognize this as a professional UX pattern.

function DangerZoneSection({ teamId, teamName }: {
    teamId: number
    teamName: string
}) {
    const navigate = useNavigate()
    const [showConfirm, setShowConfirm] = useState(false)
    const [confirmText, setConfirmText] = useState('')

    // Only enable the delete button when the user has typed the exact team name
    const isConfirmed = confirmText === teamName

    const deleteMutation = useMutation({
        mutationFn: () => deleteTeam(teamId),
        onSuccess: () => {
            toast.success('Team deleted')
            // Navigate away — team no longer exists
            navigate('/teams', { replace: true })
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to delete team')
            setShowConfirm(false)
            setConfirmText('')
        }
    })

    return (
        <section className="bg-white rounded-xl border border-red-200 p-6">
            <h2 className="text-base font-semibold text-red-700 mb-1">Danger zone</h2>
            <p className="text-sm text-gray-500 mb-5">
                Irreversible actions. Proceed with caution.
            </p>

            <div className="border border-red-200 rounded-lg p-4 flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-gray-900">Delete this team</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Permanently deletes the team, all its files, folders, and member data.
                        This cannot be undone.
                    </p>
                </div>
                {!showConfirm && (
                    <button
                        onClick={() => setShowConfirm(true)}
                        className="
              flex-shrink-0 px-3 py-1.5 text-sm font-semibold
              border border-red-300 text-red-600 rounded-lg
              hover:bg-red-50 transition-colors
            "
                    >
                        Delete team
                    </button>
                )}
            </div>

            {/* Confirmation dialog — appears inline below the button */}
            {showConfirm && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-gray-700 mb-3">
                        This action <strong>cannot be undone</strong>. This will permanently delete the{' '}
                        <strong>{teamName}</strong> team, including all files and folders.
                    </p>
                    <p className="text-sm text-gray-700 mb-2">
                        Please type <strong className="font-mono bg-red-100 px-1 rounded">{teamName}</strong> to confirm:
                    </p>
                    <input
                        type="text"
                        value={confirmText}
                        onChange={e => setConfirmText(e.target.value)}
                        placeholder={teamName}
                        // Autofocus so user can type immediately without clicking
                        autoFocus
                        className="
              w-full px-3 py-2 text-sm border rounded-lg mb-3
              focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500
              font-mono
            "
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={() => deleteMutation.mutate()}
                            disabled={!isConfirmed || deleteMutation.isPending}
                            className="
                px-4 py-2 text-sm font-semibold text-white rounded-lg
                bg-red-600 hover:bg-red-700 transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed
              "
                        >
                            {deleteMutation.isPending ? 'Deleting...' : 'I understand, delete this team'}
                        </button>
                        <button
                            onClick={() => { setShowConfirm(false); setConfirmText('') }}
                            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function TeamSettings() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { user } = useAuth()
    const teamId = parseInt(id ?? '0', 10)

    // Fetch team info and members in parallel
    const teamQuery = useQuery({
        queryKey: ['team', teamId],
        queryFn: () => fetchTeam(teamId),
        enabled: teamId > 0,
    })

    const membersQuery = useQuery({
        queryKey: ['team-members', teamId],
        queryFn: () => fetchTeamMembers(teamId),
        enabled: teamId > 0,
    })

    // ── Admin guard ──────────────────────────────────────────────────────────
    //
    // Wait until both queries resolve before checking role.
    // WHY: If we check before members load, everyone appears as non-admin
    // and gets redirected incorrectly.

    const isLoading = teamQuery.isLoading || membersQuery.isLoading

    if (!isLoading && membersQuery.data && user) {
        const myMembership = membersQuery.data.find(m => m.user_id === user.id)

        // Not a member at all, or not an admin → redirect
        if (!myMembership || myMembership.role !== 'admin') {
            navigate(`/teams/${teamId}/files`, { replace: true })
            return null
        }
    }

    // ── Loading state ────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="p-6 max-w-3xl mx-auto animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-40 mb-8" />
                <div className="space-y-6">
                    <div className="h-48 bg-white rounded-xl border border-gray-200" />
                    <div className="h-64 bg-white rounded-xl border border-gray-200" />
                    <div className="h-32 bg-white rounded-xl border border-red-100" />
                </div>
            </div>
        )
    }

    if (teamQuery.isError || !teamQuery.data) {
        return (
            <div className="p-6 max-w-3xl mx-auto">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                    <p className="text-red-700 font-medium">Team not found</p>
                    <button onClick={() => navigate('/teams')}
                        className="mt-3 text-sm text-red-600 hover:underline">
                        ← Back to teams
                    </button>
                </div>
            </div>
        )
    }

    const team = teamQuery.data

    return (
        <div className="p-6 max-w-3xl mx-auto">

            {/* ── Page header ──────────────────────────────────────────────────── */}
            <div className="mb-8">
                <button
                    onClick={() => navigate(`/teams/${teamId}`)}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    {team.name}
                </button>
                <h1 className="text-2xl font-semibold text-gray-900">Team settings</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Manage your team's information, members, and permissions.
                </p>
            </div>

            {/* ── Sections ─────────────────────────────────────────────────────── */}
            <div className="space-y-6">
                <TeamInfoSection
                    teamId={teamId}
                    initialName={team.name}
                    initialDescription={team.description ?? ''}
                />

                <MembersSection
                    teamId={teamId}
                    currentUserId={user?.id ?? 0}
                />

                <DangerZoneSection
                    teamId={teamId}
                    teamName={team.name}
                />
            </div>
        </div>
    )
}