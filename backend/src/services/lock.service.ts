// ============================================================
// lock.service.ts
// PURPOSE: All business logic for the soft file locking system.
//          This service owns every lock operation: acquire, extend,
//          release, status check, and admin force-unlock.
//
// DESIGN: We use a LEASE MODEL instead of a boolean flag.
//   - A lease has an expiry time stored in the database.
//   - Acquiring a lease is ONE atomic SQL operation (not two).
//   - This eliminates the race condition that boolean flags have.
//   - The lock owner gets a UUID token — they must present it
//     to extend or release their lock. Token forgery is impossible.
// ============================================================

import prisma from '../config/database';

import { v4 as uuidv4 } from 'uuid';  // generates cryptographically random UUIDs
import { emitToTeam } from '../socket';
import { logActivity, ActivityAction, ActivityTargetType } from '../utils/activityLogger';
import { SOCKET_EVENTS } from '../config/socketEvents';
// ─── Constants ───────────────────────────────────────────────
// How long a lease lasts before it auto-expires.
// 30 minutes is long enough for real editing sessions but short
// enough that a crashed browser doesn't block teammates for hours.
const LEASE_DURATION_MINUTES = 30;

// ─── Helper ──────────────────────────────────────────────────
// PURPOSE: Calculate the expiry timestamp for a new or extended lease.
// We call this in both acquireLock and extendLease so the duration
// is defined in ONE place — change the constant above, both update.
function newExpiresAt(): Date {
    const d = new Date();
    d.setMinutes(d.getMinutes() + LEASE_DURATION_MINUTES);
    return d;
}

// ─── Type returned by acquireLock and extendLease ────────────
export interface LeaseResult {
    lockToken: string;
    lockExpiresAt: Date;
}

// ─── Type returned by getLockStatus ─────────────────────────
export interface LockStatusResult {
    isLocked: boolean;
    lockedBy: { id: number; username: string; email: string; } | null;
    lockExpiresAt: Date | null;
    timeRemainingSeconds: number | null;
    editingStartedAt: Date | null;
}

// ============================================================
// FUNCTION 1: acquireLock
// PURPOSE:  Atomically claim a lease on a file. If the file is
//           already locked by someone with a valid lease, this
//           fails — only ONE user can win.
// INPUTS:   fileId        — which file to lock
//           userId        — who is requesting the lock
//           teamId        — needed for the audit log
//           ip            — request IP, stored in audit log
//           userAgent     — browser info, stored in audit log
// OUTPUTS:  LeaseResult { lockToken, lockExpiresAt }
//           Throws an error if file doesn't exist, user not in
//           team, or a valid lease already exists.
// WHY THIS APPROACH:
//   Prisma's updateMany returns { count: number }.
//   We use updateMany (not update) because it does NOT throw if
//   zero rows match — it just returns count: 0.
//   count = 0 means someone else holds a valid lease.
//   count = 1 means we won. This is physically atomic — the
//   database processes the WHERE check and the SET in one step.
// ============================================================
export async function acquireLock(
    fileId: number,
    userId: number,
    teamId: number,
    ip: string,
    userAgent: string
): Promise<LeaseResult> {

    // Verify the file exists and belongs to this team.
    // We check team_id so a user from Team A cannot lock Team B's files.
    const file = await prisma.file.findFirst({
        where: {
            id: fileId,
            team_id: teamId,
            is_deleted: false,   // cannot lock a deleted file
        },
    });

    if (!file) {
        // Throw a plain Error — controller will catch and send 404.
        throw new Error('FILE_NOT_FOUND');
    }

    // Generate a fresh UUID for this lease.
    // This becomes the "key card" — the lock owner must present it
    // for every heartbeat and unlock request.
    const lockToken = uuidv4();
    const lockExpiresAt = newExpiresAt();

    // THE ATOMIC ACQUIRE — this is the core of the lease model.
    //
    // updateMany only updates rows where ALL WHERE conditions are true.
    // The condition:
    //   lockExpiresAt IS NULL  → no one has locked it yet
    //   OR lockExpiresAt < NOW() → a lease exists but it has expired
    //
    // If a valid lease exists (lockExpiresAt > NOW()), zero rows match,
    // count = 0, and we know to reject the request.
    //
    // If we win, the WHERE and SET happen in one database transaction —
    // no other request can sneak in between the check and the write.
    const result = await prisma.file.updateMany({
        where: {
            id: fileId,
            team_id: teamId,
            OR: [
                { lockExpiresAt: null },                    // no lease at all
                { lockExpiresAt: { lt: new Date() } },      // lease is expired
            ],
        },
        data: {
            lockOwnerUserId: userId,
            lockToken: lockToken,
            lockExpiresAt: lockExpiresAt,
            editingStartedAt: new Date(),   // record when editing began (for UI display)
        },
    });

    // count = 0 means the WHERE clause matched nothing →
    // a valid (non-expired) lease already exists.
    if (result.count === 0) {
        throw new Error('FILE_ALREADY_LOCKED');
    }

    // Write the audit log entry.
    // fire-and-forget (no await) — never block the response for logging.
    // We include ip and userAgent so there's a full audit trail.
    void logActivity({
        teamId,
        userId,
        action: 'lock_acquired',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            lockToken,
            lockExpiresAt,
            ip,
            userAgent,
            file_name: file.original_name // ← Fixes 'item #15' issue
        },
    });
    emitToTeam(teamId, SOCKET_EVENTS.FILE_LOCKED, {
        fileId,
        lockedBy: userId,       // frontend will resolve name from its own state
        lockExpiresAt: lockExpiresAt.toISOString(),
    });
    return { lockToken, lockExpiresAt };
}

// ============================================================
// FUNCTION 2: extendLease
// PURPOSE:  The heartbeat. Called every ~25 seconds by the client
//           while the user has the file open. Resets the 30-minute
//           timer so the lease does not expire during active editing.
// INPUTS:   fileId    — which file
//           lockToken — the UUID the client received at acquire time
//           userId    — who is sending the heartbeat
//           teamId    — for audit log
// OUTPUTS:  LeaseResult with the new lockExpiresAt
//           Throws if the token doesn't match (wrong owner or expired)
// WHY TOKEN VALIDATION:
//   Without token validation, any team member could send a heartbeat
//   and extend someone else's lock — or prevent it from expiring.
//   The token proves ownership. Only the lock holder has it.
// ============================================================
export async function extendLease(
    fileId: number,
    lockToken: string,
    userId: number,
    teamId: number
): Promise<LeaseResult> {

    const newExpiry = newExpiresAt();

    // Again, atomic updateMany with strict conditions:
    //   - correct file
    //   - token must match exactly (proves ownership)
    //   - lease must not already be expired (can't revive a dead lease)
    const result = await prisma.file.updateMany({
        where: {
            id: fileId,
            team_id: teamId,
            lockToken: lockToken,           // token must match
            lockOwnerUserId: userId,        // user must be the lock owner
            lockExpiresAt: { gt: new Date() }, // lease must still be active
        },
        data: {
            lockExpiresAt: newExpiry,       // reset the 30-minute timer
        },
    });

    if (result.count === 0) {
        // Either: wrong token, wrong user, or lease already expired.
        throw new Error('LOCK_NOT_FOUND_OR_EXPIRED');
    }

    return { lockToken, lockExpiresAt: newExpiry };
}

// ============================================================
// FUNCTION 3: releaseLock
// PURPOSE:  The user voluntarily closes the file. We clear all
//           lease fields so teammates can immediately acquire it.
// INPUTS:   fileId    — which file
//           lockToken — proves the requester is the lock owner
//           userId    — who is releasing
//           teamId    — for audit log
// OUTPUTS:  { success: true }
//           Throws if token doesn't match (prevents other users
//           from releasing someone else's lock)
// WHY SOFT RELEASE (not just wait for expiry):
//   If Bob finishes editing at 2:30 PM but the lease doesn't expire
//   until 3:00 PM, Alice waits 30 minutes unnecessarily. Explicit
//   unlock gives the file back to the team immediately.
// ============================================================
export async function releaseLock(
    fileId: number,
    lockToken: string,
    userId: number,
    teamId: number,
    ip: string,       // ← add
    userAgent: string // ← add
): Promise<{ success: true }> {

    const result = await prisma.file.updateMany({
        where: {
            id: fileId,
            team_id: teamId,
            lockToken: lockToken,      // token validation — proves ownership
            lockOwnerUserId: userId,
        },
        data: {
            lockOwnerUserId: null,    // clear all lease fields
            lockToken: null,
            lockExpiresAt: null,
            editingStartedAt: null,
        },
    });

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId },
        select: { original_name: true }
    });

    // Audit log — records that this user released the lock voluntarily.
    void logActivity({
        teamId,
        userId,
        action: 'lock_released',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            ip,
            userAgent,
            file_name: file?.original_name || 'unknown'
        },
    });
    emitToTeam(teamId, SOCKET_EVENTS.FILE_UNLOCKED, { fileId, unlockedBy: userId });
    return { success: true };
}

// ============================================================
// FUNCTION 4: getLockStatus
// PURPOSE:  Any team member can check whether a file is locked,
//           who holds it, and how much time remains.
//           We NEVER return the lockToken in this response —
//           only the lock owner should have that.
// INPUTS:   fileId — which file to check
//           teamId — to verify file belongs to this team
// OUTPUTS:  LockStatusResult object
// WHY WE HIDE THE TOKEN:
//   If we exposed the token in the status response, any team member
//   could steal it and send heartbeats or unlock the file. The token
//   is a secret between the server and the lock owner only.
// ============================================================
export async function getLockStatus(
    fileId: number,
    teamId: number
): Promise<LockStatusResult> {

    // Select only the fields we need — include the lock owner's username
    // via a relation join so we can show "Alice is editing this".
    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false },
        select: {
            lockOwnerUserId: true,
            lockExpiresAt: true,
            editingStartedAt: true,
            // join to users table to get the username
            lockOwner: {
                select: { id: true, username: true, email: true },
            },
        },
    });

    if (!file) {
        throw new Error('FILE_NOT_FOUND');
    }

    // A lock is "active" only if lockExpiresAt exists AND is in the future.
    // An expired lease is treated as no lock — same as if it was cleared.
    const now = new Date();
    const isLocked =
        file.lockExpiresAt !== null && file.lockExpiresAt > now;

    if (!isLocked) {
        // File is not locked — return clean nulls.
        return {
            isLocked: false,
            lockedBy: null,
            lockExpiresAt: null,
            timeRemainingSeconds: null,
            editingStartedAt: null,
        };
    }

    // Calculate seconds remaining on the lease — useful for the UI
    // to show a countdown or "Alice has been editing for X minutes".
    const timeRemainingSeconds = Math.floor(
        (file.lockExpiresAt!.getTime() - now.getTime()) / 1000
    );

    return {
        isLocked: true,
        lockedBy: file.lockOwner ?? null,
        lockExpiresAt: file.lockExpiresAt,
        timeRemainingSeconds,
        editingStartedAt: file.editingStartedAt,
    };
}

// ============================================================
// FUNCTION 5: forceUnlock
// PURPOSE:  Admin-only override. Breaks any active lock regardless
//           of who holds it or whether the lease is still valid.
//           Always writes a forced_unlock audit entry — admins
//           are accountable for every override they perform.
// INPUTS:   fileId       — which file to force-unlock
//           adminUserId  — who is performing the override
//           teamId       — must be admin of this team
//           ip, userAgent — for the audit log
// OUTPUTS:  { success: true }
//           Throws if file not found.
// WHY AUDIT LOGGING IS NON-OPTIONAL HERE:
//   Force-unlock gives admins significant power. Without a log,
//   an admin could break locks silently and deny it. The audit
//   trail makes every override traceable and accountable.
// ============================================================
export async function forceUnlock(
    fileId: number,
    adminUserId: number,
    teamId: number,
    ip: string,
    userAgent: string
): Promise<{ success: true }> {

    // updateMany — clears lease fields unconditionally (no token check).
    // No WHERE on lockToken because the admin doesn't have it.
    const result = await prisma.file.updateMany({
        where: {
            id: fileId,
            team_id: teamId,
            is_deleted: false,
        },
        data: {
            lockOwnerUserId: null,
            lockToken: null,
            lockExpiresAt: null,
            editingStartedAt: null,
        },
    });

    if (result.count === 0) {
        throw new Error('FILE_NOT_FOUND');
    }

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId },
        select: { original_name: true }
    });

    // Audit log — action is 'forced_unlock' (distinct from 'lock_released')
    // so we can filter admin overrides separately in the activity feed.
    void logActivity({
        teamId,
        userId: adminUserId,
        action: 'lock_force_released',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            ip,
            userAgent,
            performedBy: adminUserId,
            file_name: file?.original_name || 'unknown'
        },
    });
    // Admin broke the lock — notify team so UI updates.
    emitToTeam(teamId, SOCKET_EVENTS.FILE_UNLOCKED, { fileId, forcedBy: adminUserId, unlockedBy: adminUserId });
    return { success: true };
}