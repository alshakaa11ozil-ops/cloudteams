import { Request, Response } from 'express';
import { listVersions, restoreVersion } from '../services/version.service';
import { AppError } from '../utils/teamGuard';

/**
 * GET /api/teams/:teamId/files/:fileId/versions
 */
export const getVersionsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = parseInt(req.params.fileId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(fileId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const versions = await listVersions(fileId, teamId, userId);
        res.status(200).json({ versions });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('getVersionsHandler Error:', error);
            res.status(500).json({ error: 'Internal server error fetching versions' });
        }
    }
};

/**
 * POST /api/teams/:teamId/files/:fileId/versions/:version/restore
 */
export const restoreVersionHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = parseInt(req.params.fileId as string, 10);
        const versionNumber = parseInt(req.params.version as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(fileId) || isNaN(versionNumber)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const updatedFile = await restoreVersion(fileId, versionNumber, teamId, userId);
        res.status(200).json({
            message: `Successfully restored file to version ${versionNumber}`,
            file: updatedFile
        });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('restoreVersionHandler Error:', error);
            res.status(500).json({ error: 'Internal server error restoring version' });
        }
    }
};
