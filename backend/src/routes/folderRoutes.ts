// src/routes/folderRoutes.ts

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/requireRole';
import {
    createFolderHandler,
    getTeamFoldersHandler,
    renameFolderHandler,
    deleteFolderHandler,
    moveFolderHandler, // NEW
} from '../controllers/folderController';

import { createFolderLinkHandler } from '../controllers/share.controller';

const router = Router();

// All folder routes require authentication first
// requireRole('editor', 'admin') means EITHER role is allowed

// POST /api/folders — create a folder (editors and admins only)

router.post('/', authenticate, createFolderHandler);
router.patch('/:id', authenticate, renameFolderHandler);
router.patch('/:id/move', authenticate, moveFolderHandler); // NEW
router.post('/:id/share', authenticate, createFolderLinkHandler); // NEW
router.delete('/:id', authenticate, deleteFolderHandler);
export default router;
