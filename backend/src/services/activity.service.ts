// ============================================================
// activity.service.ts
// PURPOSE: Fetch paginated activity logs for a team, with
//          optional filters for action type, date range, and
//          specific user. Returns logs with user info joined.
// WHY THIS FILE EXISTS: Activity feed is read-only — it never
//          writes. Keeping it separate from activityLogger.ts
//          (which only writes) follows the single-responsibility
//          principle and makes both files easier to maintain.
// ============================================================

import prisma from '../config/database';

// ─────────────────────────────────────────────
// TYPE: ActivityFilters
// PURPOSE: Describes every optional filter the
//          caller can pass in. Using a typed
//          interface instead of raw query params
//          means TypeScript catches typos.
// ─────────────────────────────────────────────
export interface ActivityFilters {
    page: number;       // which page of results (1-based)
    limit: number;      // how many results per page
    action?: string;    // e.g. "file_uploaded" — optional
    since?: string;     // ISO date string — only logs after this date
    filterUserId?: number; // only logs from this specific user
}

// ─────────────────────────────────────────────
// TYPE: ActivityFeedResult
// PURPOSE: Describes the exact shape this service
//          returns. The controller spreads this
//          directly into res.json() — no guessing
//          what fields exist.
// ─────────────────────────────────────────────
export interface ActivityFeedResult {
    data: ActivityEntry[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

// ─────────────────────────────────────────────
// TYPE: ActivityEntry
// PURPOSE: One row from activity_logs, enriched
//          with user info from the JOIN.
//          "user" is always present because every
//          activity log has a valid user_id FK.
// ─────────────────────────────────────────────
export interface ActivityEntry {
    id: number;
    action: string;
    target_type: string | null;
    target_id: number | null;
    metadata: unknown;        // stored as JSON — shape varies by action
    ip: string | null;
    created_at: Date;
    user: {
        id: number;
        username: string;
        email: string;
        full_name: string | null;
    };
}

// ════════════════════════════════════════════════════════════
// FUNCTION: getActivityFeed
// PURPOSE:  Fetch one page of activity logs for a given team,
//           applying any optional filters. Returns the log
//           entries AND total count for pagination math.
// INPUTS:   teamId  — which team's logs to fetch
//           filters — page, limit, action, since, filterUserId
// OUTPUTS:  ActivityFeedResult — { data[], pagination{} }
// WHY THIS APPROACH:
//   - Single prisma.findMany with include avoids N+1 queries
//   - Conditional where object keeps the filter logic clean
//   - We run findMany AND count IN PARALLEL (Promise.all) so
//     the total count doesn't add extra latency
// ════════════════════════════════════════════════════════════
export async function getActivityFeed(
    teamId: number,
    filters: ActivityFilters
): Promise<ActivityFeedResult> {

    // ── Clamp limit to max 100 ──────────────────────────────
    // Even if the caller passes limit=9999, we cap at 100.
    // This prevents a single request from dumping the entire
    // logs table into memory.
    const limit = Math.min(filters.limit, 100);
    const page = Math.max(filters.page, 1);      // page can't be 0 or negative

    // ── Calculate skip (OFFSET) ─────────────────────────────
    // page=1 → skip=0  (start from the beginning)
    // page=2 → skip=20 (jump over first 20 rows)
    // page=3 → skip=40 (jump over first 40 rows)
    const skip = (page - 1) * limit;

    // ── Build the WHERE clause conditionally ────────────────
    // Start with the mandatory filter: only this team's logs.
    // Then spread optional filters in only when they exist.
    // The `??` (nullish coalescing) and ternary approach keeps
    // this from becoming a mess of if/else blocks.
    const where = {
        team_id: teamId,

        // If action filter provided, match exactly.
        // e.g. action: "file_uploaded"
        ...(filters.action
            ? { action: filters.action }
            : {}),

        // If filterUserId provided, only show that member's actions.
        ...(filters.filterUserId
            ? { user_id: filters.filterUserId }
            : {}),

        // If since provided, only return logs AFTER that date.
        // gte = "greater than or equal to" in Prisma filter syntax.
        ...(filters.since
            ? { created_at: { gte: new Date(filters.since) } }
            : {}),
    };

    // ── Run count and data queries IN PARALLEL ───────────────
    // Promise.all fires both queries at the same time.
    // Without this, we'd wait for count to finish, THEN
    // fire the findMany — doubling the response time.
    const [total, logs] = await Promise.all([

        // Query 1: just the count — how many rows match our filter?
        // Used for totalPages calculation on the frontend.
        prisma.activityLog.count({ where }),

        // Query 2: the actual rows, paginated + enriched with user
        prisma.activityLog.findMany({
            where,
            orderBy: { created_at: 'desc' }, // newest first — standard for feeds
            skip,
            take: limit,

            // JOIN to users table — but only select safe fields.
            // Never include password_hash or two_factor_secret.
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        full_name: true,   // ADD

                    },
                },
            },
        }),
    ]);

    // ── Shape the response ───────────────────────────────────
    // Map Prisma rows to our ActivityEntry type.
    // This also means if the Prisma schema changes, we get a
    // compile error here — not a silent runtime bug.
    const data: ActivityEntry[] = logs.map(log => ({
        id: log.id,
        action: log.action,
        target_type: log.target_type,
        target_id: log.target_id,
        metadata: log.metadata,
        ip: log.ip,
        created_at: log.created_at,
        user: {
            id: log.user.id,
            username: log.user.username,
            email: log.user.email,
            full_name: log.user.full_name,
        },
    }));

    return {
        data,
        pagination: {
            page,
            limit,
            total,
            // Math.ceil: if total=87 and limit=20, totalPages=5
            // (not 4 — the 5th page has the remaining 7 entries)
            totalPages: Math.ceil(total / limit),
        },
    };
}