import { Request, Response } from 'express';
import { createSharedLink, getLinkMetadata, getTeamContent, downloadSharedFile, revokeSharedLink, listFileSharedLinks } from '../services/share.service';
import { AppError } from '../utils/teamGuard';

// ===========================================================================
// CONTROLLER: createLinkHandler
// ===========================================================================
// PURPOSE: HTTP Wrapper for both Team Shares and File Shares depending on route.
//
// WHY THIS APPROACH:
//   Controllers MUST be thin. They extract variables from `req.body` and `req.params`,
//   type-check them, and hand them safely to the service layer. We do absolutely 
//   zero team or permission checks here; that is isolated strictly in `share.service.ts`.
// ===========================================================================
// ✅ NEW — two separate controllers, each knows exactly what it handles
// No URL parsing, no ambiguity

// PURPOSE: Create a share link for a SINGLE FILE
// INPUTS:  req.params.id = fileId, req.body.teamId = teamId (required for permission check)
// OUTPUTS: 201 with the created SharedLink row
export const createFileLinkHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.body.teamId as string, 10);

        if (isNaN(fileId) || isNaN(teamId)) {
            res.status(400).json({ error: 'Valid fileId and teamId are required' });
            return;
        }

        const { password, expiresInHours, downloadLimit } = req.body;

        const link = await createSharedLink(req.user!.userId, teamId, {
            fileId,
            password: password || undefined,
            expiresInHours: expiresInHours !== undefined ? parseInt(String(expiresInHours), 10) : undefined,
            downloadLimit: downloadLimit ? parseInt(downloadLimit, 10) : undefined
        });

        res.status(201).json({ message: 'Share link generated', link });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[createFileLinkHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// PURPOSE: Create a share link for an ENTIRE TEAM (browse mode)
// INPUTS:  req.params.id = teamId
// OUTPUTS: 201 with the created SharedLink row
export const createTeamLinkHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.id as string, 10);

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Valid teamId is required' });
            return;
        }

        const { password, expiresInHours, downloadLimit } = req.body;

        const link = await createSharedLink(req.user!.userId, teamId, {
            // No fileId → service treats this as a team share
            password: password || undefined,
            expiresInHours: expiresInHours !== undefined ? parseInt(String(expiresInHours), 10) : undefined,
            downloadLimit: downloadLimit ? parseInt(downloadLimit, 10) : undefined
        });

        res.status(201).json({ message: 'Team share link generated', link });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[createTeamLinkHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// PURPOSE: Create a share link for a SINGLE FOLDER
// INPUTS:  req.params.id = folderId, req.body.teamId = teamId
// OUTPUTS: 201 with the created SharedLink row
export const createFolderLinkHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const folderId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.body.teamId as string, 10);

        if (isNaN(folderId) || isNaN(teamId)) {
            res.status(400).json({ error: 'Valid folderId and teamId are required' });
            return;
        }

        const { password, expiresInHours, downloadLimit } = req.body;

        const link = await createSharedLink(req.user!.userId, teamId, {
            folderId,
            password: password || undefined,
            expiresInHours: expiresInHours !== undefined ? parseInt(String(expiresInHours), 10) : undefined,
            downloadLimit: downloadLimit ? parseInt(downloadLimit, 10) : undefined
        });

        res.status(201).json({ message: 'Folder share link generated', link });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[createFolderLinkHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// PURPOSE: Create a share link for a SINGLE DOCUMENT
// INPUTS:  req.params.id = documentId, req.body.teamId = teamId
// OUTPUTS: 201 with the created SharedLink row
export const createDocumentLinkHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const documentId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.body.teamId as string, 10);

        if (isNaN(documentId) || isNaN(teamId)) {
            res.status(400).json({ error: 'Valid documentId and teamId are required' });
            return;
        }

        const { password, expiresInHours, downloadLimit } = req.body;

        const link = await createSharedLink(req.user!.userId, teamId, {
            documentId,
            password: password || undefined,
            expiresInHours: expiresInHours !== undefined ? parseInt(String(expiresInHours), 10) : undefined,
            downloadLimit: downloadLimit ? parseInt(downloadLimit, 10) : undefined
        });

        res.status(201).json({ message: 'Document share link generated', link });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[createDocumentLinkHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ===========================================================================
// CONTROLLER: getMetadataHandler
// ===========================================================================
// PURPOSE: Expose basic metadata (Filename, Size, RequiresPassword) for UI.
// ===========================================================================
export const getMetadataHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.token as string;
        if (!token) throw new AppError('Token is required', 400);

        const metadata = await getLinkMetadata(token);
        res.status(200).json(metadata);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ===========================================================================
// CONTROLLER: getTeamContentHandler
// ===========================================================================
// PURPOSE: Returns files and folders for a Team Share link.
// ===========================================================================
export const getTeamContentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.token as string;
        const password = req.headers['x-share-password'] as string | undefined; let folderId: number | null | undefined = undefined;

        if (req.query.folderId) {
            folderId = req.query.folderId === 'null' ? null : parseInt(req.query.folderId as string, 10);
        }

        const content = await getTeamContent(token, password, folderId);
        res.status(200).json(content);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ===========================================================================
// CONTROLLER: downloadFileHandler
// ===========================================================================
// PURPOSE: Stream binaries securely to the user.
// ===========================================================================
export const downloadFileHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.token as string;
        const password = req.headers['x-share-password'] as string | undefined;
        const requestedFileId = req.body.fileId ? parseInt(req.body.fileId, 10) : undefined;

        if (!token) throw new AppError('Token is required', 400);

        const { absolutePath, originalName } = await downloadSharedFile(token, password, requestedFileId);

        res.download(absolutePath, originalName, (err) => {
            if (err) console.error("[downloadFileHandler] Stream error:", err);
        });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ===========================================================================
// CONTROLLER: getSharedDocumentHandler
// ===========================================================================
// PURPOSE: Return read-only HTML representation of a shared document
// ===========================================================================
import { getSharedDocumentContent } from '../services/share.service';
export const getSharedDocumentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.token as string;
        const password = req.headers['x-share-password'] as string | undefined;
        const requestedDocumentId = req.query.documentId ? parseInt(req.query.documentId as string, 10) : undefined;

        if (!token) throw new AppError('Token is required', 400);

        const content = await getSharedDocumentContent(token, password, requestedDocumentId);
        res.status(200).json(content);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const revokeLinkHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.token as string;
        if (!token) throw new AppError('Token is required', 400);

        await revokeSharedLink(token, req.user!.userId);
        res.status(200).json({ message: 'Link permanently revoked' });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

// PURPOSE: List all share links for a file
// INPUTS:  req.params.id = fileId, req.query.teamId = teamId
// OUTPUTS: 200 with array of SharedLink rows
export const listFileLinksHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.query.teamId as string, 10);

        if (isNaN(fileId) || isNaN(teamId)) {
            res.status(400).json({ error: 'Valid fileId and teamId are required' });
            return;
        }

        const links = await listFileSharedLinks(req.user!.userId, teamId, fileId);
        res.status(200).json({ links });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[listFileLinksHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// PURPOSE: List all share links for a document
// INPUTS:  req.params.id = documentId, req.query.teamId = teamId
// OUTPUTS: 200 with array of SharedLink rows
export const listDocumentLinksHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const documentId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.query.teamId as string, 10);

        if (isNaN(documentId) || isNaN(teamId)) {
            res.status(400).json({ error: 'Valid documentId and teamId are required' });
            return;
        }

        const { listDocumentSharedLinks } = await import('../services/share.service');
        const links = await listDocumentSharedLinks(req.user!.userId, teamId, documentId);
        res.status(200).json({ links });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[listDocumentLinksHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ===========================================================================
// CONTROLLER: deleteShareLinkForDocHandler
// ROUTE:   DELETE /api/teams/:teamId/documents/:docId/shares/:token
// ACCESS:  editor (own links) | admin (any link)
// ===========================================================================
export const deleteShareLinkForDocHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.token as string;
        const teamId = parseInt(req.params.teamId as string, 10);
        const userId = req.user!.userId;

        if (!token || isNaN(teamId)) {
            res.status(400).json({ error: 'Valid token and teamId are required' });
            return;
        }

        const { revokeSharedLinkAdmin } = await import('../services/share.service');
        await revokeSharedLinkAdmin(token, userId, teamId);
        res.status(200).json({ message: 'Share link deleted' });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[deleteShareLinkForDocHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

