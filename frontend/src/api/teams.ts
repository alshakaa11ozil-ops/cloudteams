// src/api/teams.ts
//
// PURPOSE: All API functions related to teams.
//          Pages import these functions instead of calling api.get() directly.
//
// WHY SEPARATE FILE: If the backend endpoint changes from /teams to /v2/teams,
// we fix it in one place here — not in every component that fetches teams.
// Also makes functions easy to reuse across multiple pages.

import api from '../api/axios'

import type { Team, TeamMember } from '../types'

// ── fetchTeams ───────────────────────────────────────────────────────────────
//
// PURPOSE: Fetch all teams the logged-in user belongs to.
// INPUTS:  None — the JWT token is attached automatically by the axios interceptor
// OUTPUTS: Array of Team objects (may be empty if user has no teams)
//
// WHY RETURNS r.data directly:
// Axios wraps responses in { data, status, headers, ... }
// React Query's queryFn must return the actual data, not the axios wrapper.
// So we unwrap with .then(r => r.data) — or equivalently return r.data here.
export async function fetchTeams(): Promise<Team[]> {
    const response = await api.get<{ teams: Team[] }>('/teams')
    return response.data.teams   // ← unwrap the teams property
}

// ── createTeam ───────────────────────────────────────────────────────────────
//
// PURPOSE: Create a new team.
// INPUTS:  name (required), description (optional)
// OUTPUTS: The newly created Team object

export async function createTeam(data: {
    name: string
    description?: string
}): Promise<Team> {
    const response = await api.post<{ message: string, team: Team }>('/teams', data)
    return response.data.team
}

// ── fetchTeam ────────────────────────────────────────────────────────────────
//
// PURPOSE: Fetch a single team by ID.
// INPUTS:  teamId — the team's numeric ID from the URL params
// OUTPUTS: Single Team object
export async function fetchTeam(teamId: number): Promise<Team> {
    const response = await api.get<{ team: Team }>(`/teams/${teamId}`)
    return response.data.team    // ← unwrap from { team: ... }
}
// ── fetchTeamMembers ──────────────────────────────────────────────────────
//
// PURPOSE: Get all members of a team with their roles.
// INPUTS:  teamId — from the URL params
// OUTPUTS: Array of TeamMember objects

export async function fetchTeamMembers(teamId: number): Promise<TeamMember[]> {
    const response = await api.get<{ members: TeamMember[] }>(
        `/teams/${teamId}/members`
    )
    // Backend wraps in { members: [...] } — unwrap it
    return response.data.members ?? response.data
}

// ── fetchTeamActivity ─────────────────────────────────────────────────────
//
// PURPOSE: Get recent activity for a team (last 5 events for the dashboard).
// INPUTS:  teamId — from the URL params
// OUTPUTS: Array of ActivityLog objects

// ✅ CORRECT — matches schema.prisma: User has 'username' not 'name'
export interface ActivityLog {
    id: number
    action: string
    target_type: string
    target_id: number | null
    metadata: Record<string, unknown> | null
    created_at: string
    user: {
        id: number
        username: string   // ← correct field name from schema
        email: string
    }
}


export async function fetchTeamActivity(
    teamId: number,
    limit = 5
): Promise<ActivityLog[]> {
    const response = await api.get<{ data: ActivityLog[] }>(
        `/teams/${teamId}/activity`,
        { params: { limit, page: 1 } }
    )
    return response.data.data ?? []
}
// ── getInviteCode ─────────────────────────────────────────────────────────
export async function getInviteCode(
    teamId: number
): Promise<{ code: string; enabled: boolean }> {
    const response = await api.get(`/teams/${teamId}/invite-code`)
    return response.data
}

// ── regenerateInviteCode ──────────────────────────────────────────────────
export async function regenerateInviteCode(
    teamId: number
): Promise<{ code: string }> {
    const response = await api.post(`/teams/${teamId}/invite-code/regenerate`)
    return response.data
}

// ── joinTeamByCode ────────────────────────────────────────────────────────
export async function joinTeamByCode(
    code: string
): Promise<{ message: string; team: Team }> {
    const response = await api.post<{ message: string, team: Team }>('/teams/join', { code })
    return response.data
}

export interface DigestResult {
    digest: string
    fromCache: boolean
    cachedAt: string | null
    nextRefreshAt: string | null
}

export async function generateTeamDigest(teamId: number, force = false): Promise<DigestResult> {
    const res = await api.post<DigestResult>(`/teams/${teamId}/digest`, { force })
    return res.data
}
// ─── TEAM SETTINGS API FUNCTIONS ─────────────────────────────────────────────
// Added Week 14 — Priority 6

// PURPOSE: Update team name and/or description
// INPUTS:  teamId, fields to update (partial — send only what changed)
// OUTPUTS: Updated team object
// WHY PARTIAL: If user only changes the name, we don't send description.
//   This avoids accidentally overwriting description with a stale value.
export async function updateTeam(
    teamId: number,
    data: { name?: string; description?: string }
): Promise<void> {
    await api.patch(`/teams/${teamId}`, data)
}

// PURPOSE: Change a team member's role
// INPUTS:  teamId, userId of the member to change, new role
// OUTPUTS: void — we invalidate the members query after success
// WHY NOT RETURN MEMBER: We refetch the full list anyway for consistency
export async function updateMemberRole(
    teamId: number,
    userId: number,
    role: 'viewer' | 'editor' | 'admin'
): Promise<void> {
    await api.patch(`/teams/${teamId}/members/${userId}`, { role })
}

// PURPOSE: Remove a member from the team entirely
// INPUTS:  teamId, userId to remove
// OUTPUTS: void
// SECURITY NOTE: Backend enforces you can't remove yourself if you're
//   the only admin — we also check this on the frontend for UX
export async function removeMember(
    teamId: number,
    userId: number
): Promise<void> {
    await api.delete(`/teams/${teamId}/members/${userId}`)
}

// PURPOSE: Permanently delete the entire team and all its data
// INPUTS:  teamId
// OUTPUTS: void — navigate to /teams after success
// WHY NO RETURN: Team no longer exists after this call
export async function deleteTeam(teamId: number): Promise<void> {
    await api.delete(`/teams/${teamId}`)
}