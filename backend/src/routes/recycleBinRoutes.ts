import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getDeletedFilesHandler, restoreFileHandler, getDeletedFoldersHandler, restoreFolderHandler, getDeletedFolderContentsHandler, emptyRecycleBinHandler, hardDeleteFileHandler, hardDeleteFolderHandler, getUnifiedRecycleBinHandler, restoreDocumentHandler, hardDeleteDocumentHandler } from '../controllers/recycleBin.controller';

const router = Router();

// GET /api/teams/:teamId/recycle-bin/all
// Get all soft-deleted files and folders for a team
router.get('/:teamId/recycle-bin/all', authenticate, getUnifiedRecycleBinHandler);

// GET /api/teams/:teamId/recycle-bin
// Get all soft-deleted files for a team
router.get('/:teamId/recycle-bin', authenticate, getDeletedFilesHandler);

// POST /api/teams/:teamId/recycle-bin/files/:fileId/restore
// Restore a soft-deleted file
router.post('/:teamId/recycle-bin/files/:fileId/restore', authenticate, restoreFileHandler);

// POST /api/teams/:teamId/recycle-bin/documents/:documentId/restore
// Restore a soft-deleted document
router.post('/:teamId/recycle-bin/documents/:documentId/restore', authenticate, restoreDocumentHandler);

// GET /api/teams/:teamId/recycle-bin/folders
// Get all soft-deleted folders for a team
router.get('/:teamId/recycle-bin/folders', authenticate, getDeletedFoldersHandler);

// GET /api/teams/:teamId/recycle-bin/folders/:folderId/contents
// View deleted files and folders inside a specific deleted folder
router.get('/:teamId/recycle-bin/folders/:folderId/contents', authenticate, getDeletedFolderContentsHandler);

// POST /api/teams/:teamId/recycle-bin/folders/:folderId/restore
// Restore a soft-deleted folder and its contents
router.post('/:teamId/recycle-bin/folders/:folderId/restore', authenticate, restoreFolderHandler);

// DELETE /api/teams/:teamId/recycle-bin/empty
// Empty the entire recycle bin permanently
router.delete('/:teamId/recycle-bin/empty', authenticate, emptyRecycleBinHandler);

// DELETE /api/teams/:teamId/recycle-bin/files/:fileId
// Permanently delete a single file
router.delete('/:teamId/recycle-bin/files/:fileId', authenticate, hardDeleteFileHandler);

// DELETE /api/teams/:teamId/recycle-bin/documents/:documentId
// Permanently delete a single document
router.delete('/:teamId/recycle-bin/documents/:documentId', authenticate, hardDeleteDocumentHandler);

// DELETE /api/teams/:teamId/recycle-bin/folders/:folderId
// Permanently delete a folder
router.delete('/:teamId/recycle-bin/folders/:folderId', authenticate, hardDeleteFolderHandler);


export default router;
