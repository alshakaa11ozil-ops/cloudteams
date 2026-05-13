// frontend/src/api/announcements.ts
//
// PURPOSE: All HTTP calls for the Announcements feature.
//          Maps to backend routes in announcementRoutes.ts.
//
// BASE URL pattern: /api/teams/:teamId/announcements

import api from './axios'
import type { Announcement } from '../types'
export type { Announcement }


// ─── TYPES ───────────────────────────────────────────────────────────────────



export interface CreateAnnouncementPayload {
    title: string
    body: string
    isPinned?: boolean
}

export interface UpdateAnnouncementPayload {
    title?: string
    body?: string
    isPinned?: boolean
}

// ─── API FUNCTIONS ────────────────────────────────────────────────────────────

// PURPOSE: Fetch all announcements for a team (pinned first, then newest)
// OUTPUTS: Array of Announcement objects
export async function fetchAnnouncements(teamId: number): Promise<Announcement[]> {
    const res = await api.get<{ announcements: Announcement[] }>(
        `/teams/${teamId}/announcements`
    )
    return res.data.announcements
}

// PURPOSE: Create a new announcement (admin only)
// INPUTS:  teamId, title, body, optional isPinned flag
// OUTPUTS: Created announcement with author info
export async function createAnnouncement(
    teamId: number,
    payload: CreateAnnouncementPayload
): Promise<Announcement> {
    const res = await api.post<{ announcement: Announcement }>(
        `/teams/${teamId}/announcements`,
        payload
    )
    return res.data.announcement
}

// PURPOSE: Edit an existing announcement (author or admin)
// INPUTS:  teamId, announcementId, partial update payload
// OUTPUTS: Updated announcement
export async function updateAnnouncement(
    teamId: number,
    announcementId: number,
    payload: UpdateAnnouncementPayload
): Promise<Announcement> {
    const res = await api.patch<{ announcement: Announcement }>(
        `/teams/${teamId}/announcements/${announcementId}`,
        payload
    )
    return res.data.announcement
}

// PURPOSE: Permanently delete an announcement (author or admin)
// OUTPUTS: void — caller invalidates the query
export async function deleteAnnouncement(
    teamId: number,
    announcementId: number
): Promise<void> {
    await api.delete(`/teams/${teamId}/announcements/${announcementId}`)
}