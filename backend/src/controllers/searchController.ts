// src/controllers/searchController.ts

import { Request, Response } from 'express';
import { searchTeamContent } from '../services/search.service';
import { AppError } from '../utils/teamGuard';
// ─────────────────────────────────────────────
// CONTROLLER: searchHandler
// Route: GET /api/search?query=...&teamId=...&type=...&since=...
// PURPOSE: Parse query params, call search service, return results.
//          Controllers are THIN — no business logic here.
// ─────────────────────────────────────────────
export async function searchHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;

        // All query params arrive as strings — we must parse and validate them
        const { 
            query, 
            teamId: teamIdRaw, 
            type: typeRaw, 
            since: sinceRaw,
            mimeType: mimeTypeRaw,
            uploadedBy: uploadedByRaw,
            folderId: folderIdRaw,
            sortBy: sortByRaw,
            order: orderRaw
        } = req.query;

        // Query can be empty for smart searches with filters, handled in service.
        const queryStr = (query as string) || '';

        if (!teamIdRaw) {
            res.status(400).json({ error: 'teamId param is required' });
            return;
        }

        const teamId = parseInt(teamIdRaw as string, 10);
        if (isNaN(teamId)) {
            res.status(400).json({ error: 'teamId must be a number' });
            return;
        }

        // Validate type param — must be one of three allowed values
        const allowedTypes = ['files', 'folders', 'all'] as const;
        const type = allowedTypes.includes(typeRaw as typeof allowedTypes[number])
            ? (typeRaw as 'files' | 'folders' | 'all')
            : 'all'; // default to 'all' if not provided or invalid

        // Parse optional since date
        // WHY new Date(): JavaScript Date constructor parses ISO strings like
        // "2026-01-01" automatically. isNaN check catches invalid date strings.
        let since: Date | undefined;
        if (sinceRaw && typeof sinceRaw === 'string') {
            const parsed = new Date(sinceRaw);
            if (!isNaN(parsed.getTime())) {
                since = parsed;
            }
            // If invalid date string, silently ignore it — don't crash the search
        }

        // Parse advanced filters
        let uploadedBy: number | undefined;
        if (uploadedByRaw) {
            const parsed = parseInt(uploadedByRaw as string, 10);
            if (!isNaN(parsed)) uploadedBy = parsed;
        }
        
        let mimeType = mimeTypeRaw as string | undefined;
        let finalQuery = queryStr;

        let folderId: number | null | undefined;
        if (folderIdRaw !== undefined) {
            if (folderIdRaw === 'null') folderId = null;
            else {
                const parsed = parseInt(folderIdRaw as string, 10);
                if (!isNaN(parsed)) folderId = parsed;
            }
        }

        const sortBy = (sortByRaw as 'name' | 'date' | 'size') || 'date';
        const order = (orderRaw as 'asc' | 'desc') || 'desc';

        const result = await searchTeamContent({ 
            query: finalQuery, 
            teamId, 
            userId, 
            type, 
            since,
            mimeType: mimeType as string | undefined,
            uploadedBy,
            folderId,
            sortBy,
            order
        });

        res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error('[SearchController] Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
