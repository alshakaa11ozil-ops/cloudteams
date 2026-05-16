import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getVersionsHandler, restoreVersionHandler, saveVersionHandler } from '../controllers/version.controller';

const router = Router();

// GET /api/teams/:teamId/files/:fileId/versions
// Get all historical versions of a file
router.get('/:teamId/files/:fileId/versions', authenticate, getVersionsHandler);

// POST /api/teams/:teamId/files/:fileId/versions/:version/restore
// Restore a specific version of a file
router.post('/:teamId/files/:fileId/versions/:version/restore', authenticate, restoreVersionHandler);

// POST /api/teams/:teamId/files/:fileId/versions
// Explicitly save the current file state as a named version (editor+)
router.post('/:teamId/files/:fileId/versions', authenticate, saveVersionHandler);

export default router;
