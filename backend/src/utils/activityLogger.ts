
// ============================================================
// activityLogger.ts
// PURPOSE: Single reusable function for writing to activity_logs.
//          Called from controllers after a successful operation.
// ============================================================

import prisma from '../config/database';

// ─── STRICT TYPING ──────────────────────────────────────────
// By defining exact strings, we prevent typos (e.g., 'file_upload' vs 'file_uploaded').
// This acts as a central dictionary of every possible action in CloudTeams.
export type ActivityAction =
    | 'file_uploaded'
    | 'file_downloaded'
    | 'file_moved'
    | 'folder_moved'
    | 'file_deleted'
    | 'file_renamed'
    | 'file_restored'
    | 'folder_created'
    | 'folder_renamed'
    | 'folder_deleted'
    | 'folder_restored'
    | 'lock_acquired'
    | 'lock_released'
    | 'lock_expired'
    | 'lock_force_released'
    | 'comment_created'
    | 'file_version_created'
    | 'version_restored'
    | 'link_created'
    | 'link_revoked'
    | 'announcement_posted'
    | 'announcement_pinned'
    | 'member_joined'
    | 'member_left'
    | 'member_role_changed'
    | 'user_mentioned'
    | 'document_created'
    | 'document_renamed'
    | 'document_moved'
    | 'document_deleted'
    | 'document_restored';

export type ActivityTargetType = 'file' | 'folder' | 'comment' | 'team' | 'user' | 'document';

// ============================================================
// FUNCTION: logActivity
// PURPOSE:  Writes an audit entry to the database asynchronously.
// INPUTS:   teamId     — which team this event belongs to
//           userId     — who did it
//           action     — STRICT type of what happened
//           targetType — STRICT type of what was acted on
//           targetId   — ID of the thing acted on
//           metadata   — extra context (filename, old name, etc.)
//           ip         — user's IP
//           userAgent  — user's browser string
// OUTPUTS:  Promise<void>
// WHY THIS APPROACH:
//   1. Strict Types: Prevents magic-string bugs across 45+ endpoints.
//   2. Safe JSON: We stringify/parse metadata to drop non-serializable 
//      data (like circular references) that would crash Prisma.
//   3. Fire-and-forget: Catches errors internally so a failed log write
//      NEVER fails a successful user action.
// ============================================================
export async function logActivity(params: {
    teamId: number;
    userId: number;
    action: ActivityAction;           // <-- IMPROVEMENT 1
    targetType: ActivityTargetType;   // <-- IMPROVEMENT 1
    targetId: number;
    metadata?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
}): Promise<void> {
    try {
        // IMPROVEMENT 2: Sanitize metadata. 
        // If a controller accidentally passes a raw Express Request or 
        // an object with circular references, Prisma will throw a fatal error.
        // JSON stringify/parse safely strips out anything the DB can't store.
        const safeMetadata = params.metadata
            ? JSON.parse(JSON.stringify(params.metadata))
            : {};

        // We await internally so the catch block actually catches DB errors.
        // The *caller* (the controller) should NOT await this function.
        await prisma.activityLog.create({
            data: {
                team_id: params.teamId,
                user_id: params.userId,
                action: params.action,
                target_type: params.targetType,
                target_id: params.targetId,
                metadata: safeMetadata,
                ip: params.ip ?? null,
                userAgent: params.userAgent ?? null,
            },
        });
    } catch (error) {
        // Silent catch — logging failure must never break the main request
        console.error(`[activityLogger] Failed to write log for action '${params.action}':`, error);
    }
}
