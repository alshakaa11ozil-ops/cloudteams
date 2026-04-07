// ============================================================
// analytics.controller.ts
// PURPOSE: Parse teamId from route params, authorize the
//          caller, call the analytics service, return result.
//          Thin controller — zero business logic here.
// ============================================================

import { Request, Response } from 'express';
import { getTeamAnalytics } from '../services/analytics.service';
import { assertTeamMember } from '../utils/teamGuard';

// ════════════════════════════════════════════════════════════
// HANDLER: getAnalyticsHandler
// PURPOSE: GET /api/teams/:teamId/analytics
// INPUTS:  req.params.teamId — route parameter
// OUTPUTS: 200 AnalyticsResult | 400 | 403 | 500
// ════════════════════════════════════════════════════════════
export async function getAnalyticsHandler(
    req: Request,
    res: Response
): Promise<void> {
    try {

        // ── Parse teamId ────────────────────────────────────
        // Same reason — mounted under /:id/analytics in teamRoutes
        const teamId = parseInt(String(req.params.id), 10);
        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID' });
            return;
        }

        // ── Authorization: must be a team member ────────────
        // Viewer role is sufficient — analytics is read-only.
        // assertTeamMember throws AppError(403) if not a member.
        await assertTeamMember(req.user!.userId, teamId);

        // ── Call service ────────────────────────────────────
        const result = await getTeamAnalytics(teamId);

        res.status(200).json(result);

    } catch (err: unknown) {
        // AppError forwarding — same pattern used everywhere
        if (err instanceof Error && 'statusCode' in err) {
            const appErr = err as Error & { statusCode: number };
            res.status(appErr.statusCode).json({ error: appErr.message });
            return;
        }
        console.error('[analytics.controller] unexpected error:', err);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
}