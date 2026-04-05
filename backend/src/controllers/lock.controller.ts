// ============================================================
// lock.controller.ts
// PURPOSE: Thin HTTP layer for all lock operations.
//          Controllers do THREE things only:
//            1. Read from req (params, body, headers)
//            2. Call the service function
//            3. Send the response
//          ALL business logic lives in lock.service.ts.
//          Controllers just translate HTTP ↔ service calls.
// ============================================================

import { Request, Response } from 'express';
import * as LockService from '../services/lock.service';
import { assertTeamMember } from '../utils/teamGuard';

// ─── Helper: extract IP and User-Agent from request ─────────
// PURPOSE: We log IP and User-Agent in every lock audit entry.
//          This helper reads them from the request in one place
//          so every controller function gets them the same way.
// WHY X-FORWARDED-FOR:
//   When your app runs behind a reverse proxy (Vercel, Railway,
//   Nginx), the real client IP is in the X-Forwarded-For header,
//   not req.ip. We check that first, fall back to req.ip.
function extractRequestMeta(req: Request): { ip: string; userAgent: string } {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
        typeof forwarded === 'string'
            ? forwarded.split(',')[0].trim()   // first IP in the chain is the client
            : req.ip ?? 'unknown';

    const userAgent = req.headers['user-agent'] ?? 'unknown';
    return { ip, userAgent };
}

// ============================================================
// CONTROLLER 1: acquireLock
// ROUTE:    POST /api/teams/:teamId/files/:fileId/lock
// PURPOSE:  User opens a file for editing — claim a lease.
// INPUTS:   teamId (param), fileId (param), userId (from JWT)
// OUTPUTS:  201 { lockToken, lockExpiresAt }
//           409 if file is already locked
//           404 if file not found
// WHY 201:  We are CREATING a new lease resource — 201 Created
//           is more semantically correct than 200 OK.
// ============================================================

export async function acquireLock(req: Request, res: Response): Promise<void> {
    console.log('FULL REQ PARAMS:', JSON.stringify(req.params));
    console.log('FULL REQ URL:', req.url);
    console.log('FULL REQ PATH:', req.path);
    // TEMPORARY DEBUG — remove after fixing
    console.log('RAW PARAMS:', req.params);
    console.log('RAW teamId string:', req.params.teamId);
    console.log('PARSED teamId:', parseInt(String(req.params.teamId), 10));
    console.log('PARSED fileId:', parseInt(String(req.params.fileId), 10));

    const teamId = parseInt(String(req.params.teamId), 10);
    const fileId = parseInt(String(req.params.fileId), 10);
    // ... rest of function

    const userId = req.user!.userId;
    const { ip, userAgent } = extractRequestMeta(req);

    // Verify user is a member of this team (editor or admin can lock).
    // assertTeamMember throws if user is not a member — caught below.

    try {
        await assertTeamMember(userId, teamId, 'editor');
        const result = await LockService.acquireLock(
            fileId,
            userId,
            teamId,
            ip,
            userAgent
        );

        res.status(201).json({
            message: 'Lock acquired successfully',
            ...result,   // spreads lockToken and lockExpiresAt
        });
    } catch (err: any) {
        if (err.message === 'FILE_NOT_FOUND') {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        if (err.message === 'FILE_ALREADY_LOCKED') {
            // 409 Conflict — the resource is in a state that prevents this request.
            // This is the correct HTTP status for "someone else has the lock".
            res.status(409).json({ error: 'File is currently being edited by another user' });
            return;
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        // Unexpected error — let Express error handler deal with it.
        throw err;
    }
}

// ============================================================
// CONTROLLER 2: heartbeat
// ROUTE:    POST /api/teams/:teamId/files/:fileId/heartbeat
// PURPOSE:  Keep-alive signal from the client. Called every ~25
//           seconds while the user has the file open. Resets the
//           30-minute expiry timer.
// INPUTS:   teamId, fileId (params), lockToken (body)
// OUTPUTS:  200 { lockToken, lockExpiresAt }
//           400 if lockToken missing from body
//           403 if token doesn't match (wrong owner)
// WHY lockToken IN BODY (not header):
//   The token is application-level data, not HTTP metadata.
//   Putting secret tokens in custom headers is technically fine
//   but body is more conventional for REST APIs.
// ============================================================
export async function heartbeat(req: Request, res: Response): Promise<void> {
    const teamId = parseInt(String(req.params.teamId), 10);
    const fileId = parseInt(String(req.params.fileId), 10);
    const userId = req.user!.userId;
    const { lockToken } = req.body;

    // Validate that lockToken was sent — without it we can't prove ownership.
    if (!lockToken || typeof lockToken !== 'string') {
        res.status(400).json({ error: 'lockToken is required in request body' });
        return;
    }



    try {
        await assertTeamMember(userId, teamId);
        const result = await LockService.extendLease(
            fileId,
            lockToken,
            userId,
            teamId
        );

        res.status(200).json({
            message: 'Lease extended',
            ...result,
        });
    } catch (err: any) {
        if (err.message === 'LOCK_NOT_FOUND_OR_EXPIRED') {
            // 403 Forbidden — the token doesn't prove ownership of this lock.
            // Could mean: wrong token, lock expired, or different user.
            res.status(403).json({ error: 'Lock not found, expired, or token mismatch' });
            return;
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        throw err;
    }
}

// ============================================================
// CONTROLLER 3: releaseLock
// ROUTE:    POST /api/teams/:teamId/files/:fileId/unlock
// PURPOSE:  User closes the file — voluntarily release the lease
//           so teammates can access the file immediately.
// INPUTS:   teamId, fileId (params), lockToken (body)
// OUTPUTS:  200 { success: true }
//           400 if lockToken missing
//           403 if token doesn't match
// WHY POST NOT DELETE:
//   DELETE implies removing a resource from the database.
//   We're clearing fields on an existing record — POST to an
//   /unlock action endpoint is the REST convention for this.
// ============================================================
export async function releaseLock(req: Request, res: Response): Promise<void> {
    const teamId = parseInt(String(req.params.teamId), 10);
    const fileId = parseInt(String(req.params.fileId), 10);
    const userId = req.user!.userId;
    const { lockToken } = req.body;

    if (!lockToken || typeof lockToken !== 'string') {
        res.status(400).json({ error: 'lockToken is required in request body' });
        return;
    }



    try {
        await assertTeamMember(userId, teamId);
        const result = await LockService.releaseLock(
            fileId,
            lockToken,
            userId,
            teamId
        );

        res.status(200).json({
            message: 'Lock released successfully',
            ...result,
        });
    } catch (err: any) {
        if (err.message === 'LOCK_NOT_FOUND_OR_NOT_OWNER') {
            res.status(403).json({ error: 'You do not own this lock' });
            return;
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        throw err;
    }
}

// ============================================================
// CONTROLLER 4: getLockStatus
// ROUTE:    GET /api/teams/:teamId/files/:fileId/lock-status
// PURPOSE:  Any team member can check the current lock state.
//           Used by the UI to show "🔒 Alice is editing this"
//           or to show the file as available.
// INPUTS:   teamId, fileId (params)
// OUTPUTS:  200 { isLocked, lockedBy, lockExpiresAt,
//                 timeRemainingSeconds, editingStartedAt }
// NOTE:     lockToken is NEVER returned here — it's a secret
//           between the server and the lock owner only.
// ============================================================
export async function getLockStatus(req: Request, res: Response): Promise<void> {
    const teamId = parseInt(String(req.params.teamId), 10);
    const fileId = parseInt(String(req.params.fileId), 10);
    const userId = req.user!.userId;



    try {
        // Any team member (viewer+) can check lock status.
        await assertTeamMember(userId, teamId);
        const status = await LockService.getLockStatus(fileId, teamId);
        res.status(200).json(status);
    } catch (err: any) {
        if (err.message === 'FILE_NOT_FOUND') {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        throw err;
    }
}

// ============================================================
// CONTROLLER 5: forceUnlock
// ROUTE:    POST /api/teams/:teamId/files/:fileId/force-unlock
// PURPOSE:  Admin-only override. Breaks any active lock without
//           needing the lockToken. Always writes an audit entry.
// INPUTS:   teamId, fileId (params)
// OUTPUTS:  200 { success: true }
//           403 if caller is not an admin
//           404 if file not found
// WHY ADMIN ONLY:
//   Force-unlock can disrupt someone's active editing session.
//   Restricting it to admins prevents abuse and ensures
//   accountability — only authorized people can override locks.
// ============================================================
export async function forceUnlock(req: Request, res: Response): Promise<void> {
    const teamId = parseInt(String(req.params.teamId), 10);
    const fileId = parseInt(String(req.params.fileId), 10);
    const userId = req.user!.userId;
    const { ip, userAgent } = extractRequestMeta(req);

    // requireRole('admin') will be applied at the route level,
    // but we also call assertTeamMember here to get the membership
    // object and confirm the user truly belongs to this team.


    try {
        await assertTeamMember(userId, teamId, 'admin');
        const result = await LockService.forceUnlock(
            fileId,
            userId,
            teamId,
            ip,
            userAgent
        );

        res.status(200).json({
            message: 'Lock forcefully released by admin',
            ...result,
        });
    } catch (err: any) {
        if (err.message === 'FILE_NOT_FOUND') {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        throw err;
    }
}