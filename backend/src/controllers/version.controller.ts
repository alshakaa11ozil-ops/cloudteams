// =============================================================================
// src/controllers/version.controller.ts
// PURPOSE: HTTP layer for file version operations.
//
// ROUTES (registered in teamRoutes.ts or a dedicated versionRoutes.ts):
//   GET  /api/teams/:teamId/files/:fileId/versions
//   POST /api/teams/:teamId/files/:fileId/versions/:version/restore
//
// ARCHITECTURE RULE: Controllers are THIN.
//   ✅ Parse params, call service, send response
//   ❌ No business logic, no Prisma calls
// =============================================================================

import { Request, Response } from 'express';
import { listVersions, restoreVersion } from '../services/version.service';
import { AppError } from '../utils/teamGuard';

// ---------------------------------------------------------------------------
// CONTROLLER 1: getVersionsHandler
// ---------------------------------------------------------------------------
// PURPOSE: Return all historical versions of a file, newest first.
//
// ROUTE:   GET /api/teams/:teamId/files/:fileId/versions
//
// RESPONSE SHAPE (what frontend fetchVersions expects):
//   { versions: FileVersion[] }
//   Each FileVersion: { id, file_id, version_number, storage_path,
//                       file_size, uploaded_by, created_at,
//                       uploader: { id, username, email } }
//
// HTTP RESPONSES:
//   200 — array of versions (empty array is valid — file was never re-uploaded)
//   400 — invalid teamId or fileId
//   403 — user not in team
//   404 — file not found
//   500 — unexpected error
// ---------------------------------------------------------------------------
export const getVersionsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = parseInt(req.params.fileId as string, 10);

        if (isNaN(teamId) || isNaN(fileId)) {
            res.status(400).json({ error: 'Invalid teamId or fileId' });
            return;
        }

        const versions = await listVersions(fileId, teamId, req.user!.userId);

        // Always return { versions: [...] } — never return the array directly.
        // The frontend fetchVersions reads res.data.versions explicitly.
        res.status(200).json({ versions });
    } catch (err) {
        if (err instanceof AppError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        console.error('[getVersionsHandler]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 2: restoreVersionHandler
// ---------------------------------------------------------------------------
// PURPOSE: Roll a file back to a previous version.
//          The current state is snapshotted first so nothing is lost.
//
// ROUTE:   POST /api/teams/:teamId/files/:fileId/versions/:version/restore
//
// WHY version is in the URL (not body):
//   REST convention: the resource being targeted is part of the URL.
//   "Restore version 3 of file 21" → /files/21/versions/3/restore
//   This makes it clear, bookmarkable, and cacheable.
//
// RESPONSE SHAPE:
//   { message: string, file: CloudFile }
//   The updated file record — frontend uses this to refresh the file list.
//
// HTTP RESPONSES:
//   200 — version restored successfully
//   400 — already at this version, or invalid params
//   403 — user is viewer (editors+ only)
//   404 — file or version not found
//   500 — unexpected error
// ---------------------------------------------------------------------------
export const restoreVersionHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = parseInt(req.params.fileId as string, 10);
        const versionNumber = parseInt(req.params.version as string, 10);

        // All three params are required — any NaN is a malformed request
        if (isNaN(teamId) || isNaN(fileId) || isNaN(versionNumber)) {
            res.status(400).json({ error: 'Invalid teamId, fileId, or version number' });
            return;
        }

        const updatedFile = await restoreVersion(
            fileId,
            versionNumber,
            teamId,
            req.user!.userId,
            req.ip ?? 'unknown',
            req.headers['user-agent'] ?? 'unknown'
        );

        res.status(200).json({
            message: `File restored to version ${versionNumber}`,
            file: updatedFile,
        });
    } catch (err) {
        if (err instanceof AppError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        console.error('[restoreVersionHandler]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};