// src/utils/activityLogger.ts

import prisma from '../config/database';

// PURPOSE: Single reusable function for writing to activity_logs.
//          Called from controllers after a successful operation.
//
// WHY CONTROLLERS NOT SERVICES:
//   Services handle business logic. Logging is an infrastructure concern.
//   Keeping them separate means services are easier to test — you can
//   test a service without worrying about side effects like logging.
//
// WHY void (fire-and-forget):
//   Logging must NEVER cause a user request to fail. If the log write
//   crashes, the user's upload/rename/delete already succeeded.
//   We catch silently so the error never reaches the user.
//
// INPUTS:
//   teamId     — which team this event belongs to
//   userId     — who did it
//   action     — what happened ('file_uploaded', 'folder_created', etc.)
//   targetType — what was acted on ('file', 'folder')
//   targetId   — ID of the thing acted on
//   metadata   — any extra context (filename, old name, file size, etc.)
//   ip         — user's IP (req.ip)
//   userAgent  — user's browser string (req.headers['user-agent'])
/*//
export async function logActivity(params: {
    teamId: number;
    userId: number;
    action: string;
    targetType: string;
    targetId: number;
    metadata?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
}): Promise<void> {
    try {
        await prisma.activityLog.create({
            data: {
                team_id: params.teamId,
                user_id: params.userId,
                action: params.action,
                target_type: params.targetType,
                target_id: params.targetId,
                metadata: params.metadata ?? {},
                ip: params.ip ?? null,
                userAgent: params.userAgent ?? null,
            },
        });
    } catch (error) {
        // Silent catch — logging failure must never break the main request
        console.error('[activityLogger] Failed to write log:', error);
    }
}*///