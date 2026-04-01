// src/services/search.service.ts

import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';

// ─────────────────────────────────────────────
// TYPE: SearchOptions
// PURPOSE: Strongly typed input for the search function.
//          TypeScript catches typos at compile time.
// ─────────────────────────────────────────────
interface SearchOptions {
    query: string;
    teamId: number;
    userId: number;
    type: 'files' | 'folders' | 'all';
    since?: Date;
}

// ─────────────────────────────────────────────
// SERVICE: searchTeamContent
// PURPOSE: Search files and/or folders in a team by name.
//          Returns a combined, sorted list with a resultType field.
//
// INPUTS:  SearchOptions (query, teamId, userId, type, since)
// OUTPUTS: { query, teamId, totalResults, results[] }
//
// WHY ILIKE: Case-insensitive pattern matching built into PostgreSQL.
//   Simple, no extra indexes needed, easy to explain in a defense.
//   Full-text search (tsvector) is more powerful but overkill here.
//
// WHY Promise.all: File and folder queries are independent.
//   Running them in parallel halves the total DB wait time.
// ─────────────────────────────────────────────
export async function searchTeamContent(options: SearchOptions) {
    const { query, teamId, userId, type, since } = options;

    // Step 1: Verify membership — assertTeamMember throws AppError(403)
    // if the user doesn't belong to this team
    await assertTeamMember(userId, teamId);

    // Step 2: Validate query is not empty after trimming whitespace
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        throw new AppError('Search query cannot be empty', 400);
    }

    // Step 3: Run file and folder queries in PARALLEL
    // WHY: Both queries are independent — no reason to wait for one before
    // starting the other. Promise.all runs them simultaneously.
    const [files, folders] = await Promise.all([

        // ── FILE SEARCH ────────────────────────────────────────────────
        // Skip entirely if user only wants folders
        type === 'folders'
            ? Promise.resolve([])
            : prisma.file.findMany({
                where: {
                    team_id: teamId,
                    is_deleted: false,
                    original_name: {
                        contains: trimmedQuery,
                        mode: 'insensitive', // Prisma's way of writing ILIKE
                    },
                    // Spread date filter only when 'since' was provided
                    ...(since && { created_at: { gte: since } }),
                },
                select: {
                    id: true,
                    original_name: true,
                    mime_type: true,
                    file_size: true,
                    folder_id: true,
                    created_at: true,
                    uploader: {
                        select: { id: true, username: true, email: true },
                    },
                },
                orderBy: { created_at: 'desc' },
                take: 50, // never return thousands of rows at once
            }),

        // ── FOLDER SEARCH ──────────────────────────────────────────────
        // Skip entirely if user only wants files
        type === 'files'
            ? Promise.resolve([])
            : prisma.folder.findMany({
                where: {
                    team_id: teamId,
                    is_deleted: false,
                    name: {
                        contains: trimmedQuery,
                        mode: 'insensitive',
                    },
                    ...(since && { created_at: { gte: since } }),
                },
                select: {
                    id: true,
                    name: true,
                    parent_folder_id: true,
                    created_by: true, // plain integer — Folder has no User relation
                    created_at: true,
                },
                orderBy: { created_at: 'desc' },
                take: 50,
            }),
    ]);

    // Step 4: Tag each result so the frontend knows what type it is
    // WHY TAG: Frontend receives one combined array — needs to know
    // whether to show a file icon or folder icon for each item
    const taggedFiles = files.map((file) => ({
        resultType: 'file' as const, // 'as const' = literal type, not just string
        id: file.id,
        name: file.original_name,
        mimeType: file.mime_type,
        fileSize: file.file_size,
        folderId: file.folder_id,
        createdAt: file.created_at,
        uploadedBy: file.uploader,
    }));

    const taggedFolders = folders.map((folder) => ({
        resultType: 'folder' as const,
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parent_folder_id,
        createdBy: folder.created_by,
        createdAt: folder.created_at,
    }));

    // Step 5: Merge and sort by date — newest first across both types
    // WHY RE-SORT: Each query is sorted individually, but after merging
    // files and folders need to be interleaved by date correctly
    const combined = [...taggedFiles, ...taggedFolders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return {
        query: trimmedQuery,
        teamId,
        totalResults: combined.length,
        results: combined,
    };
}