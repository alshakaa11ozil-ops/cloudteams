import { Request, Response } from 'express';
import { listDeletedFiles, restoreFile, listDeletedFolders, restoreFolder, getDeletedFolderContents, hardDeleteFile, hardDeleteFolder, emptyRecycleBin, getUnifiedRecycleBin, restoreDocument, hardDeleteDocument } from '../services/recycleBin.service';
import { AppError } from '../utils/teamGuard';
import { logActivity } from '../utils/activityLogger';

/**
 * GET /api/teams/:teamId/recycle-bin/all
 */
export const getUnifiedRecycleBinHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID format' });
            return;
        }

        const data = await getUnifiedRecycleBin(teamId, userId);
        res.status(200).json({
            message: "Successfully retrieved all items in the recycle bin.",
            ...data
        });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('getUnifiedRecycleBinHandler Error:', error);
            res.status(500).json({ error: 'Internal server error processing unified recycle bin request' });
        }
    }
};

/**
 * GET /api/teams/:teamId/recycle-bin
 */
export const getDeletedFilesHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        // Assuming req.user is set by auth middleware
        const userId = req.user!.userId;

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID format' });
            return;
        }

        const files = await listDeletedFiles(teamId, userId);
        res.status(200).json({
            message: "Successfully retrieved recycle bin files.",
            files: files
        });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('getDeletedFilesHandler Error:', error);
            res.status(500).json({ error: 'Internal server error processing recycle bin request' });
        }
    }
};

/**
 * POST /api/teams/:teamId/recycle-bin/:fileId/restore
 */
export const restoreFileHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = parseInt(req.params.fileId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(fileId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }
        // In any controller that passes ip/userAgent to a service:

        // WHY x-forwarded-for: when Express sits behind a reverse proxy (Nginx, 
        // Heroku router, Railway), the real client IP is in this header.
        // req.ip alone returns the proxy's address, not the user's address.
        // We fall through to req.ip as the final fallback for direct connections.
        const ip =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
            req.ip ??
            'unknown'

        // WHY split(',')[0]: x-forwarded-for can contain multiple IPs if the
        // request passed through multiple proxies: "clientIP, proxy1, proxy2"
        // We only want the first one — that's the original client.

        const userAgent = (req.headers['user-agent'] as string) ?? 'unknown'
        const file = await restoreFile(
            fileId,
            teamId,
            userId,
            ip,
            userAgent
        );

        res.status(200).json({ message: 'File restored successfully', file: file });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('restoreFileHandler Error:', error);
            res.status(500).json({ error: 'Internal server error restoring file' });
        }
    }
};

/**
 * POST /api/teams/:teamId/recycle-bin/documents/:documentId/restore
 */
export const restoreDocumentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const documentId = parseInt(req.params.documentId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(documentId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const ip =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
            req.ip ??
            'unknown'

        const userAgent = (req.headers['user-agent'] as string) ?? 'unknown'
        const document = await restoreDocument(
            documentId,
            teamId,
            userId,
            ip,
            userAgent
        );

        res.status(200).json({ message: 'Document restored successfully', document });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('restoreDocumentHandler Error:', error);
            res.status(500).json({ error: 'Internal server error restoring document' });
        }
    }
};

/**
 * GET /api/teams/:teamId/recycle-bin/folders
 */
export const getDeletedFoldersHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID format' });
            return;
        }

        const folders = await listDeletedFolders(teamId, userId);
        res.status(200).json({
            message: "Successfully retrieved recycle bin folders.",
            folders: folders
        });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('getDeletedFoldersHandler Error:', error);
            res.status(500).json({ error: 'Internal server error processing recycle bin request' });
        }
    }
};

/**
 * GET /api/teams/:teamId/recycle-bin/folders/:folderId/contents
 */
export const getDeletedFolderContentsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const folderId = parseInt(req.params.folderId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(folderId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const contents = await getDeletedFolderContents(folderId, teamId, userId);
        res.status(200).json({
            message: "Successfully retrieved deleted folder contents.",
            data: contents
        });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('getDeletedFolderContentsHandler Error:', error);
            res.status(500).json({ error: 'Internal server error processing recycle bin folder contents' });
        }
    }
};

/**
 * POST /api/teams/:teamId/recycle-bin/folders/:folderId/restore
 */
export const restoreFolderHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const folderId = parseInt(req.params.folderId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(folderId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }
        // In any controller that passes ip/userAgent to a service:

        // WHY x-forwarded-for: when Express sits behind a reverse proxy (Nginx, 
        // Heroku router, Railway), the real client IP is in this header.
        // req.ip alone returns the proxy's address, not the user's address.
        // We fall through to req.ip as the final fallback for direct connections.
        const ip =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
            req.ip ??
            'unknown'

        // WHY split(',')[0]: x-forwarded-for can contain multiple IPs if the
        // request passed through multiple proxies: "clientIP, proxy1, proxy2"
        // We only want the first one — that's the original client.

        const userAgent = (req.headers['user-agent'] as string) ?? 'unknown'
        const result = await restoreFolder(
            folderId,
            teamId,
            userId,
            ip,
            userAgent
        );
        res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('restoreFolderHandler Error:', error);
            res.status(500).json({ error: 'Internal server error restoring folder' });
        }
    }
};

/**
 * DELETE /api/teams/:teamId/recycle-bin/empty
 */
export const emptyRecycleBinHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID format' });
            return;
        }

        const result = await emptyRecycleBin(teamId, userId);
        res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('emptyRecycleBinHandler Error:', error);
            res.status(500).json({ error: 'Internal server error emptying recycle bin' });
        }
    }
};

/**
 * DELETE /api/teams/:teamId/recycle-bin/files/:fileId
 */
export const hardDeleteFileHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = parseInt(req.params.fileId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(fileId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const result = await hardDeleteFile(fileId, teamId, userId);
        res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('hardDeleteFileHandler Error:', error);
            res.status(500).json({ error: 'Internal server error permanently deleting file' });
        }
    }
};

/**
 * DELETE /api/teams/:teamId/recycle-bin/documents/:documentId
 */
export const hardDeleteDocumentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const documentId = parseInt(req.params.documentId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(documentId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const result = await hardDeleteDocument(documentId, teamId, userId);
        res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('hardDeleteDocumentHandler Error:', error);
            res.status(500).json({ error: 'Internal server error permanently deleting document' });
        }
    }
};

/**
 * DELETE /api/teams/:teamId/recycle-bin/folders/:folderId
 */
export const hardDeleteFolderHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const folderId = parseInt(req.params.folderId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(folderId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const result = await hardDeleteFolder(folderId, teamId, userId);
        res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('hardDeleteFolderHandler Error:', error);
            res.status(500).json({ error: 'Internal server error permanently deleting folder' });
        }
    }
};
