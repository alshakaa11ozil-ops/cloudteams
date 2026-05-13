// backend/src/services/inviteCode.service.ts
//
// PURPOSE: Handles team invite codes — generation, regeneration, and joining.
//
// WHY SEPARATE SERVICE: Invite code logic is self-contained.
// Keeping it here instead of teamService.ts prevents that file
// from growing too large.

import prisma from '../config/database'
import crypto from 'crypto'
import { logActivity } from '../utils/activityLogger';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';

// ── generateInviteCode ────────────────────────────────────────────────────
//
// PURPOSE: Generate a cryptographically random 8-character alphanumeric code.
//
// WHY crypto.randomBytes and not Math.random():
//   Math.random() is not cryptographically secure — patterns can be predicted.
//   crypto.randomBytes() uses the OS entropy pool — truly unpredictable.
//
// WHY 8 characters:
//   6 characters = 36^6 = ~2 billion combinations — hard to brute force.
//   8 characters = 36^8 = ~2.8 trillion — even safer.
//   Short enough to share verbally or type manually.

function generateInviteCode(): string {
    // Generate 6 random bytes → convert to base36 (0-9 + a-z) → take first 8 chars
    // toUpperCase() makes it easier to read and share verbally
    return crypto
        .randomBytes(6)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')  // remove non-alphanumeric chars
        .substring(0, 8)
        .toUpperCase()
}

// ── createInviteCode ──────────────────────────────────────────────────────
//
// PURPOSE: Generate and save an invite code for a team.
//          Called when a team is created (no code yet) or when admin regenerates.
//
// INPUTS:  teamId — the team to generate a code for
// OUTPUTS: The new invite code string

export async function createInviteCode(teamId: number): Promise<string> {
    // First verify the team exists
    const team = await prisma.team.findUnique({ where: { id: teamId } })
    if (!team) throw new Error('Team not found')

    let attempts = 0
    while (attempts < 10) {
        const code = crypto
            .randomBytes(6)
            .toString('base64')
            .replace(/[^a-zA-Z0-9]/g, '')
            .substring(0, 8)
            .toUpperCase()

        try {
            await prisma.team.update({
                where: { id: teamId },
                data: { invite_code: code, invite_code_enabled: true },
            })
            return code
        } catch (err: unknown) {
            if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
                attempts++
                continue
            }
            throw err
        }
    }
    throw new Error('Failed to generate unique invite code')
}

// ── regenerateInviteCode ──────────────────────────────────────────────────
//
// PURPOSE: Admin replaces the existing code with a new one.
//          Old code immediately stops working.
//
// WHY THIS MATTERS: If an invite link was shared too widely or leaked,
// the admin can cut off access instantly by regenerating.

export async function regenerateInviteCode(
    teamId: number,
    requestingUserId: number
): Promise<string> {
    // Verify the requesting user is an admin of this team
    const membership = await prisma.teamMember.findFirst({
        where: { team_id: teamId, user_id: requestingUserId },
    })

    if (!membership || membership.role !== 'admin') {
        throw new Error('FORBIDDEN')
    }

    return createInviteCode(teamId)
}

// ── joinTeamByCode ────────────────────────────────────────────────────────
//
// PURPOSE: Add a user to a team using an invite code.
//
// INPUTS:  code — the invite code from the URL or form
//          userId — the authenticated user joining
//
// OUTPUTS: The team they just joined

export async function joinTeamByCode(code: string, userId: number) {
    // Find the team with this code
    const team = await prisma.team.findFirst({
        where: {
            invite_code: code.toUpperCase().trim(),
            invite_code_enabled: true,  // code must be active
        },
    })

    if (!team) {
        // Don't reveal whether the code exists but is disabled,
        // or simply doesn't exist — same error either way.
        // WHY: Security through ambiguity — don't help attackers enumerate codes.
        throw new Error('INVALID_CODE')
    }

    // Check if user is already a member
    const existing = await prisma.teamMember.findFirst({
        where: { team_id: team.id, user_id: userId },
    })

    if (existing) {
        throw new Error('ALREADY_MEMBER')
    }

    // Add them as editor — the default role for people who join via invite
    // WHY editor not viewer: If someone was given the link, they're expected
    // to contribute. Viewer is for people explicitly restricted by an admin.
    await prisma.teamMember.create({
        data: {
            team_id: team.id,
            user_id: userId,
            role: 'editor',
        },
    })

    // Log the activity
    void logActivity({
        teamId: team.id,
        userId: userId,
        action: 'member_joined',
        targetType: 'team',
        targetId: team.id,
        metadata: { method: 'invite_code' },
    });

    // Real-time notification via helper
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    emitToTeam(team.id, SOCKET_EVENTS.MEMBER_JOINED, {
        userId: userId,
        username: user?.username || 'New Member',
        role: 'editor'
    });

    return team
}

// ── getInviteCode ─────────────────────────────────────────────────────────
//
// PURPOSE: Get the current invite code for a team (admin only).
// INPUTS:  teamId, requestingUserId
// OUTPUTS: { code, enabled } or generates one if none exists

export async function getInviteCode(
    teamId: number,
    requestingUserId: number
): Promise<{ code: string; enabled: boolean }> {
    const membership = await prisma.teamMember.findFirst({
        where: { team_id: teamId, user_id: requestingUserId },
    })

    if (!membership || membership.role !== 'admin') {
        throw new Error('FORBIDDEN')
    }

    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { invite_code: true, invite_code_enabled: true },
    })

    if (!team) throw new Error('NOT_FOUND')

    // Generate one if it doesn't exist yet
    if (!team.invite_code) {
        const code = await createInviteCode(teamId)
        return { code, enabled: true }
    }

    return {
        code: team.invite_code,
        enabled: team.invite_code_enabled,
    }
}