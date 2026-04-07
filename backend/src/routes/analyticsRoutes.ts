// ============================================================
// analyticsRoutes.ts
// PURPOSE: Wire GET / to the analytics controller.
//          mergeParams: true inherits :teamId from teamRoutes.
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getAnalyticsHandler } from '../controllers/analytics.controller';

// mergeParams: true — makes :teamId visible inside this router
const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/analytics
router.get('/', authenticate, getAnalyticsHandler);

export default router;