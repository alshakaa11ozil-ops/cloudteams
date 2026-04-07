// ============================================================
// activityRoutes.ts
// PURPOSE: Wire the URL pattern to the controller handler.
//          Authentication is applied here. Role check is
//          applied in teamRoutes when this router is mounted.
// WHY mergeParams: true:
//   This router is mounted under /api/teams/:teamId/...
//   mergeParams: true makes :teamId visible inside THIS router.
//   Without it, req.params.teamId would be undefined.
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getActivityFeedHandler } from '../controllers/activity.controller';

// mergeParams: true — inherit :teamId from the parent router
const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/activity
// authenticate: verify JWT token is valid
// getActivityFeedHandler: authorization check + query + response
router.get('/', authenticate, getActivityFeedHandler);

export default router;