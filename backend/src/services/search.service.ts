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
    mimeType?: string;
    uploadedBy?: number;
    folderId?: number | null;
    sortBy?: 'name' | 'date' | 'size';
    order?: 'asc' | 'desc';
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

    // Step 2: Validate query is not empty after trimming whitespace, unless we have filters
    const trimmedQuery = query.trim();
    if (!trimmedQuery && !options.mimeType && !options.uploadedBy && options.folderId === undefined) {
        // Return empty results if no query and no filters
        return { query: '', teamId, totalResults: 0, results: [] };
    }

    // Step 3: Run file, folder, and document queries in PARALLEL
    const [files, folders, documents] = await Promise.all([

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
                    // Spread optional filters
                    ...(since && { created_at: { gte: since } }),
                    ...(options.mimeType && { mime_type: { contains: options.mimeType } }),
                    ...(options.uploadedBy && { uploaded_by: options.uploadedBy }),
                    ...(options.folderId !== undefined && { folder_id: options.folderId }),
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
        // Skip entirely if user only wants files or if filtering by mimeType
        type === 'files' || options.mimeType
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
                    ...(options.uploadedBy && { created_by: options.uploadedBy }),
                    ...(options.folderId !== undefined && { parent_folder_id: options.folderId }),
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

        // ── DOCUMENT SEARCH ────────────────────────────────────────────
        type === 'folders' || options.mimeType
            ? Promise.resolve([])
            : prisma.documents.findMany({
                where: {
                    team_id: teamId,
                    is_deleted: false,
                    title: {
                        contains: trimmedQuery,
                        mode: 'insensitive',
                    },
                    ...(since && { created_at: { gte: since } }),
                    ...(options.uploadedBy && { created_by: options.uploadedBy }),
                    ...(options.folderId !== undefined && { folder_id: options.folderId }),
                },
                select: {
                    id: true,
                    title: true,
                    folder_id: true,
                    created_by: true,
                    last_saved: true,
                    created_at: true,
                    updated_at: true,
                    users: {
                        select: { id: true, username: true, email: true, full_name: true },
                    },
                },
                orderBy: { updated_at: 'desc' },
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

    const taggedDocuments = documents.map((doc) => ({
        resultType: 'document' as const,
        id: doc.id,
        title: doc.title,
        folderId: doc.folder_id,
        createdBy: doc.created_by,
        creatorName: doc.creator?.full_name ?? doc.creator?.username ?? doc.creator?.email ?? null,
        lastSaved: doc.last_saved,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
    }));

    // Step 5: Merge and sort dynamically based on sortBy and order
    const combined = [...taggedFiles, ...taggedFolders, ...taggedDocuments];
    combined.sort((a, b) => {
        const orderMult = options.order === 'asc' ? 1 : -1;
        
        if (options.sortBy === 'name') {
            const nameA = a.resultType === 'document' ? a.title : a.name;
            const nameB = b.resultType === 'document' ? b.title : b.name;
            return nameA.localeCompare(nameB) * orderMult;
        } else if (options.sortBy === 'size') {
            const sizeA = a.resultType === 'file' ? a.fileSize : 0;
            const sizeB = b.resultType === 'file' ? b.fileSize : 0;
            return (sizeA - sizeB) * orderMult;
        } else {
            // default to 'date'
            return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * orderMult;
        }
    });

    return {
        query: trimmedQuery,
        teamId,
        totalResults: combined.length,
        results: combined,
    };
}
