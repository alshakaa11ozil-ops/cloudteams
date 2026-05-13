// src/utils/teamGuard.ts

import prisma from '../config/database';

// ─────────────────────────────────────────────
// SHARED ERROR CLASS
// PURPOSE: A single typed error class used by every service in the app.
//          Carries an HTTP status code so controllers never have to guess
//          what status to send — the error tells them directly.
//
// WHY ONE CLASS FOR ALL SERVICES:
//   Before this, each service had its own error class (FolderServiceError,
//   SearchServiceError, etc.) — all identical except the name.
//   That violates DRY. One class, imported everywhere, is cleaner.
//
// USAGE:
//   throw new AppError('File not found', 404);
//   throw new AppError('Insufficient permissions', 403);
//   throw new AppError('Folder already exists', 409);
// ─────────────────────────────────────────────
export class AppError extends Error {
    constructor(public message: string, public statusCode: number) {
        super(message);
        this.name = 'AppError';
    }
}

// Keep these aliases so existing service files don't break.
// They all point to the same class — just different names.
// WHY ALIASES: folder.service.ts throws FolderServiceError,
// search.service.ts throws SearchServiceError — rather than
// renaming every throw in every file right now, aliases let us
// migrate gradually without breaking anything.
export const FolderServiceError = AppError;
export const SearchServiceError = AppError;

// ─────────────────────────────────────────────
// ROLE HIERARCHY
// Higher number = more permissions.
// WHY A MAP: O(1) lookup, easy to extend.
// To add 'superadmin' later: just add superadmin: 4
// ─────────────────────────────────────────────
const ROLE_HIERARCHY: Record<string, number> = {
    viewer: 1,
    editor: 2,
    admin: 3,
};

// ─────────────────────────────────────────────
// assertTeamMember
// PURPOSE: Verify user belongs to a team AND has the minimum required role.
//          Every service calls this instead of repeating the DB query.
//
// INPUTS:
//   userId      — who is acting
//   teamId      — which team they're acting on
//   minimumRole — lowest role allowed (default: 'viewer' = any member)
//
// OUTPUTS: The membership record (.role available to caller)
//
// THROWS AppError:
//   403 — not a member of this team
//   403 — role is below the minimum required
// ─────────────────────────────────────────────
export async function assertTeamMember(
    userId: number,
    teamId: number,
    minimumRole: 'viewer' | 'editor' | 'admin' = 'viewer'
) {
    const membership = await prisma.teamMember.findFirst({
        where: { user_id: userId, team_id: teamId },
    });

    if (!membership) {
        throw new AppError('You are not a member of this team', 403);
    }

    const userLevel = ROLE_HIERARCHY[membership.role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

    if (userLevel < requiredLevel) {
        throw new AppError(
            `Insufficient permissions. Required: ${minimumRole}, your role: ${membership.role}`,
            403
        );
    }

    return membership;
}
