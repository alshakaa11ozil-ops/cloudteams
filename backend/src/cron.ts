// ============================================================
// cron.ts
// PURPOSE: Scheduled background jobs that run automatically on
//          a timer — no user action needed to trigger them.
//          Currently contains one job: auto-expire stale leases.
//
// WHY A CRON JOB FOR LOCK EXPIRY:
//   If a user's browser crashes, their lock token is lost forever.
//   They can't send an unlock request because they don't have the
//   token anymore. Without a cleanup job, that file stays locked
//   until someone manually intervenes.
//   The cron job solves this: every 30 minutes it finds all leases
//   where lockExpiresAt is in the past and clears them — exactly
//   like a library automatically returning overdue books.
//
// WHY node-cron (not setInterval):
//   setInterval drifts over time and doesn't survive server
//   restarts cleanly. node-cron uses standard cron syntax,
//   is well-tested, and is the industry standard for scheduled
//   jobs in Node.js applications.
// ============================================================

import cron from 'node-cron';
import prisma from './config/database';
import { emitToTeam } from './socket';
import { logActivity } from './utils/activityLogger';

// ============================================================
// FUNCTION: startCronJobs
// PURPOSE:  Register all scheduled jobs and start them.
//           Called ONCE in server.ts after the server starts.
//           Adding new scheduled jobs in the future means adding
//           them here — one place manages all scheduled work.
// INPUTS:   none
// OUTPUTS:  void (jobs run in the background indefinitely)
// ============================================================
export function startCronJobs(): void {
    // ── Job: Auto-Expire Stale Leases ────────────────────────
    // CRON SYNTAX: '*/30 * * * *'
    //   */30  → every 30 minutes (0, 30 past each hour)
    //   *     → every hour
    //   *     → every day of month
    //   *     → every month
    //   *     → every day of week
    //
    // So this runs at: :00 and :30 of every hour, every day.
    // That means a crashed lock is cleaned up within 30 minutes
    // of its expiry — acceptable for a collaboration tool.
    cron.schedule('*/30 * * * *', async () => {
        console.log('[Cron] Running stale lock cleanup job...');

        try {
            await expireStaleLeases();
        } catch (err) {
            // Log but never crash — a failed cron job should not
            // bring down the entire server. Next run will retry.
            console.error('[Cron] Stale lock cleanup failed:', err);
        }
    });

    console.log('[Cron] Stale lock cleanup job scheduled (every 30 minutes)');
}

// ============================================================
// FUNCTION: expireStaleLeases
// PURPOSE:  Find all files with an expired lease, clear their
//           lock fields, broadcast 'file.lockExpired' to the
//           team room, and write an audit log entry for each.
// INPUTS:   none (reads from database directly)
// OUTPUTS:  Promise<void>
// WHY WE FETCH BEFORE UPDATING:
//   We need teamId and fileId for each expired lock to:
//     1. Emit the Socket.io event to the right team room
//     2. Write the audit log with the correct teamId
//   If we used updateMany directly, we'd get a count but not
//   the individual records. So we findMany first, then update
//   each one (or use a single updateMany + separate findMany).
//   For a graduation project with small data volumes, fetching
//   first is clean and readable. At scale, you'd use a raw SQL
//   UPDATE ... RETURNING query instead.
// ============================================================
async function expireStaleLeases(): Promise<void> {
    const now = new Date();

    // Step 1: Find all files with an expired (but not yet cleared) lease.
    // A lease is "stale" when lockExpiresAt exists AND is in the past.
    // We select only the fields we need — no point fetching file content.
    const expiredLocks = await prisma.file.findMany({
        where: {
            lockExpiresAt: {
                lt: now,   // lt = less than = in the past
            },
            lockOwnerUserId: {
                not: null, // only files that actually have a lock owner
            },
            is_deleted: false,
        },
        select: {
            id: true,
            team_id: true,
            lockOwnerUserId: true,
            filename: true,   // for the log message
        },
    });

    if (expiredLocks.length === 0) {
        console.log('[Cron] No stale leases found.');
        return;
    }

    console.log(`[Cron] Found ${expiredLocks.length} stale lease(s) to expire.`);

    // Step 2: Clear all stale leases in ONE updateMany call.
    // More efficient than updating each file individually in a loop.
    // We collect the IDs first, then update them all at once.
    const expiredFileIds = expiredLocks.map(f => f.id);

    await prisma.file.updateMany({
        where: {
            id: { in: expiredFileIds },   // update only the stale ones
        },
        data: {
            lockOwnerUserId: null,   // clear lock owner
            lockToken: null,   // invalidate the token
            lockExpiresAt: null,   // clear expiry
            editingStartedAt: null,   // clear editing start time
        },
    });

    // Step 3: For each expired lock, broadcast the event and log it.
    // We do this AFTER the database update so we never emit an event
    // for a lock that failed to clear.
    for (const file of expiredLocks) {
        // Broadcast to the team room so all open browsers update instantly.
        // The client sees 'file.lockExpired' and removes the lock warning UI.
        emitToTeam(file.team_id, 'file.lockExpired', {
            fileId: file.id,
            filename: file.filename,
        });

        // Write audit log — system is the actor (userId = lockOwnerUserId
        // because we log WHO held the lock that expired, not who expired it).
        // action 'lock_expired' is distinct from 'lock_released' so you can
        // filter "how many locks expired due to inactivity" in analytics.
        void logActivity({
            teamId: file.team_id,
            userId: file.lockOwnerUserId!,  // who held the expired lock
            action: 'lock_expired',
            targetType: 'file',
            targetId: file.id,
            metadata: {
                filename: file.filename,
                expiredAt: now.toISOString(),
                reason: 'auto_expired_by_cron',
            },
        });

        console.log(
            `[Cron] Expired lock on file ${file.id} (${file.filename}) ` +
            `held by user ${file.lockOwnerUserId}`
        );
    }
}
// ===========================================================================
// CRON JOB: cleanExpiredBlacklistTokens
// ===========================================================================
// PURPOSE: Deletes rows from token_blacklist where the token has already
//          naturally expired. An expired token is rejected by jwt.verify()
//          BEFORE the blacklist check runs — so these rows are dead weight.
//
// SCHEDULE: Every hour ('0 * * * *')
//   — Tokens live max 7 days, so hourly cleanup is more than sufficient.
//   — Running it more often wastes DB resources; less often grows the table.
//
// WHY THIS MATTERS:
//   Without cleanup, the blacklist table grows without bound. Every logout
//   adds a row. A large table makes the findUnique lookup slower and wastes
//   storage. Cleanup keeps the table containing only ACTIVE revocations.
// ===========================================================================
cron.schedule('0 * * * *', async () => {
    try {
        const result = await prisma.tokenBlacklist.deleteMany({
            where: {
                // expires_at < NOW() means the JWT's own expiry has passed.
                // jwt.verify() would already reject these tokens on its own.
                // Deleting them is safe — they can never be used again regardless.
                expires_at: { lt: new Date() }
            }
        });

        // Only log if something was actually deleted — reduces log noise
        if (result.count > 0) {
            console.log(`[cron] Cleaned ${result.count} expired blacklist token(s)`);
        }
    } catch (error) {
        // Never let a cron failure crash the server — just log and continue
        console.error('[cron] Blacklist cleanup failed:', error);
    }
});