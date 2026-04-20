// src/controllers/folderController.ts

import { Request, Response } from 'express';
import {
    createFolder,
    getTeamFolders,
    renameFolder,
    deleteFolder,
    moveFile,
    moveFolder, // ← NEW
} from '../services/folder.service';
import { AppError } from '../utils/teamGuard';
import { logActivity } from '../utils/activityLogger';
// ─────────────────────────────────────────────
// HELPER: handleError
// PURPOSE: Central error handler for all folder controllers.
//          Maps FolderServiceError (with statusCode) to HTTP responses.
//          Maps unknown errors to 500 Internal Server Error.
// WHY: Avoids copy-pasting the same try/catch pattern in every controller.
// ─────────────────────────────────────────────

// UPDATE handleError to use AppError:
function handleError(res: Response, error: unknown) {
    if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
    }
    console.error('[FolderController] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
}

// ─────────────────────────────────────────────
// CONTROLLER: createFolderHandler
// Route: POST /api/folders
// ─────────────────────────────────────────────
export async function createFolderHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;

        // multipart/form-data sends everything as strings, so parseInt is needed.
        // Regular JSON bodies also work fine with parseInt on numeric strings.
        const teamId = parseInt(req.body.teamId, 10);
        const { name } = req.body;

        // parentFolderId is optional — only parse it if it was actually provided
        const parentFolderId = req.body.parentFolderId
            ? parseInt(req.body.parentFolderId, 10)
            : undefined;
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

        if (!name || isNaN(teamId)) {
            res.status(400).json({ error: 'name and teamId are required' });
            return;
        }

        const folder = await createFolder(
            name,
            teamId,
            userId,
            ip,
            userAgent,
            parentFolderId
        );

        res.status(201).json({ folder });
    } catch (error) {
        handleError(res, error);
    }
}

// ─────────────────────────────────────────────
// CONTROLLER: getTeamFoldersHandler
// Route: GET /api/teams/:id/folders
// ─────────────────────────────────────────────
export async function getTeamFoldersHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;
        const teamId = parseInt(req.params.id as string, 10); // :id = team ID from URL

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID' });
            return;
        }

        const folders = await getTeamFolders(teamId, userId);
        res.status(200).json({ folders });
    } catch (error) {
        handleError(res, error);
    }
}

// ─────────────────────────────────────────────
// CONTROLLER: renameFolderHandler
// Route: PATCH /api/folders/:id
// ─────────────────────────────────────────────
export async function renameFolderHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;
        const folderId = parseInt(req.params.id as string, 10);
        const { name, teamId: teamIdRaw } = req.body;
        const teamId = parseInt(teamIdRaw, 10);

        if (!name || isNaN(folderId) || isNaN(teamId)) {
            res.status(400).json({ error: 'name and teamId are required' });
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
        const folder = await renameFolder(
            folderId,
            name,
            teamId,
            userId,
            ip,
            userAgent
        );
        res.status(200).json({ folder });
    } catch (error) {
        handleError(res, error);
    }
}

// ─────────────────────────────────────────────
// CONTROLLER: deleteFolderHandler
// Route: DELETE /api/folders/:id
// Query param: ?recursive=true  → delete folder + all files inside
//              (omitted)        → refuse if files exist
// ─────────────────────────────────────────────

export async function deleteFolderHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;
        const folderId = parseInt(req.params.id as string, 10);
        const { teamId: teamIdRaw } = req.body;
        const teamId = parseInt(teamIdRaw, 10);

        if (isNaN(folderId) || isNaN(teamId)) {
            res.status(400).json({ error: 'teamId is required in request body' });
            return;
        }

        // Read ?recursive query param — default to 'false' (protect mode)
        const rawRecursive = req.query.recursive;

        // Validate it's one of the three allowed values
        // WHY: We don't want to pass arbitrary strings into the service
        const allowed = ['false', 'files', 'true'] as const;
        const recursive = allowed.includes(rawRecursive as typeof allowed[number])
            ? (rawRecursive as 'false' | 'files' | 'true')
            : 'false'; // default to safest mode if param is missing or invalid
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
        const result = await deleteFolder(
            folderId,
            teamId,
            userId,
            ip,
            userAgent,
            recursive
        );

        // Build a human-readable message based on what actually happened
        let message = 'Folder deleted successfully';
        if (result.orphanedFiles > 0) {
            message = `Folder deleted. ${result.orphanedFiles} file(s) moved to root level.`;
        } else if (result.deletedFiles > 0) {
            message = `Folder and ${result.deletedFiles} file(s) deleted successfully.`;
        }

        res.status(200).json({ message, ...result });
    } catch (error) {
        handleError(res, error);
    }
}
// Route: PATCH /api/files/:id
// Body: { teamId, folderId }  — folderId can be null to move to root
// ─────────────────────────────────────────────
export async function moveFileHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;
        const fileId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.body.teamId, 10);

        if (isNaN(fileId) || isNaN(teamId)) {
            res.status(400).json({ error: 'teamId is required' });
            return;
        }

        // folderId can be null (move to root) or a number (move to folder)
        // We check explicitly for null string sent from client
        const targetFolderId =
            req.body.folderId === null || req.body.folderId === 'null'
                ? null
                : parseInt(req.body.folderId, 10);
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
        const file = await moveFile(
            fileId,
            targetFolderId,
            teamId,
            userId,
            ip,
            userAgent
        );
        res.status(200).json({ file });
    } catch (error) {
        handleError(res, error);
    }
}

// ─────────────────────────────────────────────
// CONTROLLER: moveFolderHandler
// Route: PATCH /api/folders/:id/move
// Body: { teamId, targetFolderId }  — targetFolderId can be null to move to root
// ─────────────────────────────────────────────
export async function moveFolderHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;
        const folderId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.body.teamId, 10);
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

        if (isNaN(folderId) || isNaN(teamId)) {
            res.status(400).json({ error: 'folderId from params and teamId from body are required' });
            return;
        }

        // targetFolderId can be null (move to root) or a number (move to folder)
        const targetFolderId =
            req.body.targetFolderId === null || req.body.targetFolderId === 'null'
                ? null
                : parseInt(req.body.targetFolderId, 10);

        const folder = await moveFolder(
            folderId,
            targetFolderId,
            teamId,
            userId,
            ip,
            userAgent
        );
        res.status(200).json({ folder });
    } catch (error) {
        handleError(res, error);
    }
}