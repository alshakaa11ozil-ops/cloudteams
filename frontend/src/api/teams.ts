// src/api/teams.ts
//
// PURPOSE: All API functions related to teams.
//          Pages import these functions instead of calling api.get() directly.
//
// WHY SEPARATE FILE: If the backend endpoint changes from /teams to /v2/teams,
// we fix it in one place here — not in every component that fetches teams.
// Also makes functions easy to reuse across multiple pages.

import api from '@/api/axios'

import type { Team, TeamMember } from '@/types'

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

export interface ActivityLog {
    id: number
    action: string        // e.g. "file_uploaded", "member_invited"
    target_type: string   // e.g. "file", "folder", "member"
    target_id: number | null
    metadata: Record<string, unknown> | null
    created_at: string
    user: {
        id: number
        name: string
        email: string
    }
}

export async function fetchTeamActivity(
    teamId: number,
    limit = 5
): Promise<ActivityLog[]> {
    const response = await api.get<{ activities: ActivityLog[] }>(
        `/teams/${teamId}/activity`,
        { params: { limit, page: 1 } }
    )
    return response.data.activities ?? []
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