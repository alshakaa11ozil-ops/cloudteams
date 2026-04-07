// ============================================================
// activity.controller.ts
// PURPOSE: Read query params from the request, validate them,
//          call the service, and send the response.
//          Controllers are THIN — no business logic here.
// ============================================================

import { Request, Response } from 'express';
import { getActivityFeed } from '../services/activity.service';
import { assertTeamMember } from '../utils/teamGuard';

// ════════════════════════════════════════════════════════════
// HANDLER: getActivityFeedHandler
// PURPOSE: GET /api/teams/:teamId/activity
//          Returns paginated activity logs for the team.
// INPUTS (from Express req):
//   req.params.teamId   — which team (from URL)
//   req.query.page      — page number (default 1)
//   req.query.limit     — page size (default 20)
//   req.query.action    — optional action filter
//   req.query.since     — optional ISO date filter
//   req.query.userId    — optional member filter
// OUTPUTS: JSON ActivityFeedResult or error
// ════════════════════════════════════════════════════════════
export async function getActivityFeedHandler(
    req: Request,
    res: Response
): Promise<void> {
    try {

        // ── Parse and validate teamId ────────────────────────
        // parseInt with radix 10 — never skip the radix argument.
        // "010" parses as 8 in octal without it.
        // teamRoutes mounts this as /:id/activity so Express names
        // the param "id". We read id — no fallback needed.
        const teamId = parseInt(String(req.params.id), 10);
        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID' });
            return;
        }

        // ── Verify caller is a team member ───────────────────
        // assertTeamMember throws AppError(403) if not a member.
        // We don't need the returned membership object here —
        // just the authorization check — so we discard the result.
        await assertTeamMember(req.user!.userId, teamId);

        // ── Parse pagination params ───────────────────────────
        // Query params arrive as strings — always parse them.
        // || 1 and || 20 provide safe defaults if omitted.
        const page = parseInt(String(req.query.page || '1'), 10);
        const limit = parseInt(String(req.query.limit || '20'), 10);

        // Validate pagination values are usable numbers
        if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
            res.status(400).json({ error: 'page and limit must be positive integers' });
            return;
        }

        // ── Parse optional filter params ─────────────────────
        // These are all optional — undefined means "no filter".
        const action = req.query.action ? String(req.query.action) : undefined;
        const since = req.query.since ? String(req.query.since) : undefined;

        // filterUserId is a number filter but arrives as string
        const filterUserId = req.query.userId
            ? parseInt(String(req.query.userId), 10)
            : undefined;

        // ── Validate since is a real date ────────────────────
        // new Date('banana') produces Invalid Date — isNaN catches it.
        if (since && isNaN(new Date(since).getTime())) {
            res.status(400).json({ error: 'since must be a valid ISO date string' });
            return;
        }

        // ── Call service ─────────────────────────────────────
        const result = await getActivityFeed(teamId, {
            page,
            limit,
            action,
            since,
            filterUserId,
        });

        // ── Send response ─────────────────────────────────────
        res.status(200).json(result);

    } catch (err: unknown) {
        // ── AppError forwarding pattern ───────────────────────
        // AppError has a statusCode property — use it directly.
        // Unknown errors default to 500.
        if (err instanceof Error && 'statusCode' in err) {
            const appErr = err as Error & { statusCode: number };
            res.status(appErr.statusCode).json({ error: appErr.message });
            return;
        }
        console.error('[activity.controller] unexpected error:', err);
        res.status(500).json({ error: 'Failed to fetch activity feed' });
    }
}