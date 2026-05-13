// src/routes/searchRoutes.ts

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { searchHandler } from '../controllers/searchController';

const router = Router();

// GET /api/search?query=...&teamId=...&type=...&since=...
// authenticate confirms who the user is.
// Authorization (team membership) is checked inside the service.
router.get('/', authenticate, searchHandler);

export default router;
