// src/services/folder.service.ts

import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity, ActivityAction, ActivityTargetType } from '../utils/activityLogger';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';
// ─────────────────────────────────────────────
// CUSTOM ERROR CLASS
// PURPOSE: Lets controllers know WHAT went wrong and WHAT HTTP status to send.
// WHY THIS APPROACH: Instead of throwing generic Error objects and guessing
// the status code in the controller, we attach the status code to the error
// itself. The controller just catches and forwards it. Clean separation.
// ─────────────────────────────────────────────

// PURPOSE: Typed error class for folder operations.
// Carries an HTTP status code so the controller knows what to respond with.
// WHY: Throwing a plain Error loses the status code — we'd have to guess
// in the controller whether it's a 404 or 403. This makes it explicit.

// ─────────────────────────────────────────────
// HELPER: verifyMembership
// PURPOSE: Confirm a user belongs to a team before letting them touch anything.
// INPUTS:  userId (number), teamId (number)
// OUTPUTS: The TeamMember record (contains their role)
// WHY: Every folder operation must be scoped to the team. Without this check,
//      a user could read or modify folders from a team they don't belong to
//      just by guessing folder IDs. This is called an IDOR vulnerability
//      (Insecure Direct Object Reference) — a top OWASP security risk.
// ─────────────────────────────────────────────
// PURPOSE: Verify user belongs to team AND has at least the minimum role.
// INPUTS:  userId, teamId, minimumRole (optional — defaults to 'viewer')
// WHY: Centralizes both membership AND role checking in the service layer,
//      which is the correct place when the URL doesn't contain the teamId.


// ─────────────────────────────────────────────
// HELPER: buildBreadcrumb
// PURPOSE: Given a folder ID and a flat list of all folders, return the
//          -full path from root to that folder.
// INPUTS:  folderId (number), allFolders (array of Folder records)
// OUTPUTS: string[] e.g. ["Finance", "Q1", "Invoices"]
// WHY THIS APPROACH: We load all folders once into a Map (O(1) lookup),
//          then walk up the parent_folder_id chain in memory. This avoids
//          N recursive database queries (one per level). For typical folder
//          depths (3-6 levels), this is always faster.
// ─────────────────────────────────────────────
function buildBreadcrumb(
    folderId: number,
    allFolders: Array<{ id: number; name: string; parent_folder_id: number | null }>
): string[] {
    // Build a Map so we can look up any folder by ID in O(1) time
    // instead of scanning the array every time (O(n) per lookup)
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));

    const path: string[] = [];
    let current = folderMap.get(folderId);

    // Walk up the tree until we reach a folder with no parent (root level)
    while (current) {
        path.unshift(current.name); // unshift = insert at FRONT of array (we're going up)
        if (current.parent_folder_id === null) break; // reached root
        current = folderMap.get(current.parent_folder_id);
    }

    return path;
}

// ─────────────────────────────────────────────
// HELPER: getAllDescendantIds
// PURPOSE: Given a folder ID, find ALL nested child folder IDs recursively.
//          Used when soft-deleting a folder to also delete its children.
// INPUTS:  folderId (number), allFolders (array of all team folders)
// OUTPUTS: number[] — flat list of every descendant folder ID
// WHY: Prisma does not support recursive CTEs directly. We load all folders
//      once and do the recursion in JavaScript. For a graduation project
//      this is perfectly correct and much easier to explain than raw SQL CTEs.
// ─────────────────────────────────────────────
function getAllDescendantIds(
    folderId: number,
    allFolders: Array<{ id: number; parent_folder_id: number | null }>
): number[] {
    const result: number[] = [];

    // Find direct children of this folder
    const children = allFolders.filter((f) => f.parent_folder_id === folderId);

    for (const child of children) {
        result.push(child.id); // add the child itself
        // Recursively add all of the child's descendants
        result.push(...getAllDescendantIds(child.id, allFolders));
    }

    return result;
}

// ─────────────────────────────────────────────
// SERVICE: createFolder
// PURPOSE: Create a new folder inside a team. Validates membership,
//          validates parent folder (if given), then creates the record.
// INPUTS:  name, teamId, parentFolderId (optional), userId
// OUTPUTS: The newly created Folder record
// ─────────────────────────────────────────────
export async function createFolder(
    name: string,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string,
    parentFolderId?: number
) {
    // Step 1: Confirm user is a member of this team
    await assertTeamMember(userId, teamId, 'editor');

    // Step 2: If a parent folder is specified, verify it belongs to the SAME team.
    // WHY: Without this check, a user could nest a folder under a folder from a
    // completely different team, breaking isolation between teams.
    if (parentFolderId !== undefined) {
        const parent = await prisma.folder.findFirst({
            where: {
                id: parentFolderId,
                team_id: teamId,       // must belong to same team
                is_deleted: false,     // can't nest under a deleted folder
            },
        });

        if (!parent) {
            throw new AppError(
                'Parent folder not found or does not belong to this team',
                404
            );
        }
    }

    // Step 3: Create the folder
    const folder = await prisma.folder.create({
        data: {
            name,
            team_id: teamId,
            created_by: userId,
            // If no parentFolderId, this is a root-level folder (parent_folder_id = null)
            parent_folder_id: parentFolderId ?? null,
        },
    });
    void logActivity({
        teamId,
        userId,
        action: 'folder_created',
        targetType: 'folder',
        targetId: folder.id,
        metadata: { folder_name: folder.name, parentFolderId: parentFolderId ?? null },
        ip,
        userAgent,
    })
    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.FOLDER_CREATED, {
        folder: folder as unknown as Record<string, unknown>,
        createdBy: userId
    });

    return folder;
}

// ─────────────────────────────────────────────
// SERVICE: getTeamFolders
// PURPOSE: Return all non-deleted folders in a team, each with its breadcrumb path.
// INPUTS:  teamId, userId
// OUTPUTS: Array of folders, each enriched with a `breadcrumb` string[] field
// WHY FLAT LIST: Returning a flat list is simpler and more flexible. The frontend
//               can build a tree from it. This is how Google Drive's API works.
// ─────────────────────────────────────────────
export async function getTeamFolders(teamId: number, userId: number) {
    // Confirm membership
    await assertTeamMember(userId, teamId, 'viewer');

    // Fetch all non-deleted folders for this team in one query
    const folders = await prisma.folder.findMany({
        where: {
            team_id: teamId,
            is_deleted: false,
        },
        orderBy: { created_at: 'asc' }, // consistent ordering
    });

    // Enrich each folder with its computed breadcrumb path
    // We pass the full `folders` array to buildBreadcrumb so it can do
    // all lookups in memory — no additional DB queries needed
    const enriched = folders.map((folder) => ({
        ...folder,
        breadcrumb: buildBreadcrumb(folder.id, folders),
    }));

    return enriched;
}

// ─────────────────────────────────────────────
// SERVICE: renameFolder
// PURPOSE: Update the name of a folder.
// INPUTS:  folderId, newName, teamId, userId
// OUTPUTS: The updated Folder record
// ─────────────────────────────────────────────
export async function renameFolder(
    folderId: number,
    newName: string,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) {
    // Confirm membership
    await assertTeamMember(userId, teamId, 'editor');
    // Find the folder — must belong to this team and not be deleted
    const folder = await prisma.folder.findFirst({
        where: {
            id: folderId,
            team_id: teamId,
            is_deleted: false,
        },
    });

    if (!folder) {
        throw new AppError('Folder not found', 404);
    }

    // Perform the rename
    const updated = await prisma.folder.update({
        where: { id: folderId },
        data: { name: newName },
    });
    void logActivity({
        teamId,
        userId,
        action: 'folder_renamed',
        targetType: 'folder',
        targetId: folderId,
        metadata: { oldName: folder.name, newName, folder_name: newName },
        ip,
        userAgent,
    });
    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.FOLDER_RENAMED, {
        folderId: folderId,
        oldName: folder.name,
        newName: newName,
        renamedBy: userId
    });

    return updated;
}

// ─────────────────────────────────────────────
// SERVICE: deleteFolder
// PURPOSE: Soft-delete a folder. Two modes:
//   - recursive=false (default): refuse if folder contains any files.
//     This PROTECTS team files from accidental loss.
//   - recursive=true: soft-delete the folder, ALL descendant folders,
//     AND all files inside them, atomically in a single transaction.
//     The user explicitly confirmed they want this.
//
// INPUTS:  folderId, teamId, userId, recursive (boolean)
// OUTPUTS: Summary object { deletedFolders: number, deletedFiles: number }
//
// WHY SOFT DELETE: Files are team assets. Hard delete is irreversible.
//   Soft delete means data goes to the recycle bin and can be recovered.
//   This directly satisfies the supervisor requirement: "Data recovery, recycle bin".
//
// WHY TRANSACTION: When recursive=true, we're updating multiple tables.
//   If the server crashes between the folder update and the file update,
//   the database would be in an inconsistent state. prisma.$transaction
//   guarantees ALL updates succeed or NONE do. This is called atomicity —
//   the A in ACID database properties.
// ─────────────────────────────────────────────
export async function deleteFolder(
    folderId: number,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string,
    recursive: 'false' | 'files' | 'true'  // three explicit string modes
) {
    // Confirm membership
    await assertTeamMember(userId, teamId, 'editor');

    // Find the folder — must belong to this team and not already be deleted
    const folder = await prisma.folder.findFirst({
        where: {
            id: folderId,
            team_id: teamId,
            is_deleted: false,
        },
    });

    if (!folder) {
        throw new AppError('Folder not found', 404);
    }

    // Load ALL non-deleted folders in this team to find descendants in memory.
    // WHY IN MEMORY: Avoids N recursive DB queries. We load once, recurse in JS.
    const allTeamFolders = await prisma.folder.findMany({
        where: { team_id: teamId, is_deleted: false },
        select: { id: true, parent_folder_id: true },
    });

    // Get every descendant folder ID (children, grandchildren, etc.)
    const descendantIds = getAllDescendantIds(folderId, allTeamFolders);

    // Full set of folder IDs affected = the target folder + all its descendants
    const allFolderIdsToDelete = [folderId, ...descendantIds];

    const now = new Date(); // one timestamp shared across all updates in this operation

    // ── MODE A: PROTECT ──────────────────────────────────────────────
    if (recursive === 'false') {
        const fileCount = await prisma.file.count({
            where: {
                folder_id: { in: allFolderIdsToDelete },
                is_deleted: false,
            },
        });

        if (fileCount > 0) {
            // Tell the client exactly how many files are at risk
            // so the frontend can show: "This folder contains 5 files. What do you want to do?"
            throw new AppError(
                `This folder contains ${fileCount} file(s). Choose an option: ` +
                `use ?recursive=files to keep the files (moved to root), ` +
                `or ?recursive=true to delete everything.`,
                409 // 409 Conflict = request conflicts with current resource state
            );
        }

        // No files — safe to delete folder(s) only
        const updatedFolders = await prisma.folder.updateMany({
            where: { id: { in: allFolderIdsToDelete } },
            data: { is_deleted: true, deleted_at: now },
        });

        // Audit log
        void logActivity({
            teamId,
            userId,
            action: 'folder_deleted',
            targetType: 'folder',
            targetId: folderId,
            metadata: { mode: recursive, folder_name: folder.name },
            ip,
            userAgent,
        });

        // Real-time notification via helper
        emitToTeam(teamId, SOCKET_EVENTS.FOLDER_DELETED, {
            folderId: folderId,
            deletedBy: userId
        });

        return { deletedFolders: updatedFolders.count, deletedFiles: 0, orphanedFiles: 0 };
    }

    // ── MODE B: ORPHAN FILES ─────────────────────────────────────────
    if (recursive === 'files') {
        // Run both operations atomically in a transaction:
        // 1. Move all files inside to root (folder_id = null) — they survive
        // 2. Soft-delete all the folders
        const [movedFiles, deletedFolders] = await prisma.$transaction([
            // Operation 1: Detach files from their folders — move them to root
            // WHY null: folder_id = null means "root level, no folder"
            prisma.file.updateMany({
                where: {
                    folder_id: { in: allFolderIdsToDelete },
                    is_deleted: false, // only touch live files
                },
                data: {
                    folder_id: null, // orphan to root — file is kept, just loses its folder
                },
            }),

            // Operation 2: Soft-delete all the folders
            prisma.folder.updateMany({
                where: { id: { in: allFolderIdsToDelete } },
                data: { is_deleted: true, deleted_at: now },
            }),
        ]);

        // Audit log
        void logActivity({
            teamId,
            userId,
            action: 'folder_deleted',
            targetType: 'folder',
            targetId: folderId,
            metadata: { mode: recursive, folder_name: folder.name },
            ip,
            userAgent,
        });

        return {
            deletedFolders: deletedFolders.count,
            deletedFiles: 0,                    // no files were deleted
            orphanedFiles: movedFiles.count,    // files moved to root
        };
    }

    // ── MODE C: DELETE EVERYTHING ────────────────────────────────────
    // recursive === 'true'
    const [updatedFiles, updatedFolders] = await prisma.$transaction([
        // Operation 1: Soft-delete all files inside the folders
        prisma.file.updateMany({
            where: {
                folder_id: { in: allFolderIdsToDelete },
                is_deleted: false,
            },
            data: { is_deleted: true, deleted_at: now },
        }),

        // Operation 2: Soft-delete all the folders
        prisma.folder.updateMany({
            where: { id: { in: allFolderIdsToDelete } },
            data: { is_deleted: true, deleted_at: now },
        }),
    ]);

    // Audit log - unified for all modes
    void logActivity({
        teamId,
        userId,
        action: 'folder_deleted',
        targetType: 'folder',
        targetId: folderId,
        metadata: { mode: recursive, folder_name: folder.name },
        ip,
        userAgent,
    });

    return {
        deletedFolders: updatedFolders.count,
        deletedFiles: updatedFiles.count,
        orphanedFiles: 0,
    };
}

// ─────────────────────────────────────────────
// SERVICE: moveFile
// PURPOSE: Move a file to a different folder (or to root level).
// INPUTS:  fileId, targetFolderId (number | null), teamId, userId
// OUTPUTS: The updated File record
// WHY: This is the core of folder organization. Users drag files between
//      folders. We always validate the destination belongs to the same team.
// ─────────────────────────────────────────────
export async function moveFile(
    fileId: number,
    targetFolderId: number | null,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) {
    // Confirm membership
    await assertTeamMember(userId, teamId, 'editor');

    // Find the file — must belong to this team and not be deleted
    const file = await prisma.file.findFirst({
        where: {
            id: fileId,
            team_id: teamId,
            is_deleted: false,
        },
    });

    if (!file) {
        throw new AppError('File not found', 404);
    }

    if (file.lockExpiresAt && file.lockExpiresAt > new Date() && file.lockOwnerUserId !== userId) {
        throw new AppError('Cannot move file: it is currently locked by another user', 409);
    }

    // If moving to a specific folder (not root), validate the destination
    if (targetFolderId !== null) {
        const destinationFolder = await prisma.folder.findFirst({
            where: {
                id: targetFolderId,
                team_id: teamId,     // must be in same team
                is_deleted: false,   // can't move into a deleted folder
            },
        });

        if (!destinationFolder) {
            throw new AppError(
                'Destination folder not found or does not belong to this team',
                404
            );
        }
    }

    // Update the file's folder_id
    // null = move to root level (no folder)
    const updated = await prisma.file.update({
        where: { id: fileId },
        data: { folder_id: targetFolderId },
    });
    void logActivity({
        teamId,
        userId,
        action: 'file_moved',
        targetType: 'file',
        targetId: fileId,
        metadata: { file_name: file.original_name, targetFolderId },
        ip,
        userAgent,
    });
    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.FILE_MOVED, {
        fileId: fileId,
        fileName: file.original_name,
        targetFolderId: targetFolderId,
        movedBy: userId
    });

    return updated;
}

// ─────────────────────────────────────────────
// SERVICE: moveFolder
// PURPOSE: Change the parent of a folder — the folder moves to a new location
//          in the hierarchy (or to root level if targetParentId is null).
//
// INPUTS:
//   folderId       — the folder being moved
//   targetParentId — destination folder ID (null = move to root)
//   teamId         — team context for all authorization checks
//   userId         — must be editor or admin
//
// OUTPUTS: The updated Folder record
//
// EDGE CASES HANDLED:
//   1. Moving folder into itself → 400 Bad Request
//   2. Moving folder into one of its own descendants → 400 (circular reference)
//      e.g. Moving "Finance" into "Finance/Q1" would make "Finance" its own ancestor
//   3. Destination folder belongs to another team → 404
//   4. Destination folder is soft-deleted → 404
//
// WHY THE CIRCULAR REFERENCE CHECK:
//   Without it, you could create a cycle in the folder tree:
//   A → B → C → A  (A is its own ancestor, infinite loop in tree rendering)
//   We use getAllDescendantIds (already defined above) to get all descendants
//   of the folder being moved, then verify the target is NOT in that set.
// ─────────────────────────────────────────────
export async function moveFolder(
    folderId: number,
    targetParentId: number | null,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) {
    // Step 1: verify the user has write access
    await assertTeamMember(userId, teamId, 'editor');

    // Step 2: find the folder being moved
    const folder = await prisma.folder.findFirst({
        where: { id: folderId, team_id: teamId, is_deleted: false },
    });

    if (!folder) {
        throw new AppError('Folder not found', 404);
    }

    // Step 3: reject trivially invalid move — folder cannot become its own parent
    if (targetParentId === folderId) {
        throw new AppError('A folder cannot be moved into itself', 400);
    }

    // Step 4: if moving to a specific folder (not root), run extra validation
    if (targetParentId !== null) {
        // 4a. Verify the destination folder exists and belongs to the same team
        const destination = await prisma.folder.findFirst({
            where: { id: targetParentId, team_id: teamId, is_deleted: false },
        });

        if (!destination) {
            throw new AppError(
                'Destination folder not found or does not belong to this team',
                404
            );
        }

        // 4b. Circular reference guard
        // Load all folders so we can find descendants in memory (no recursive DB queries)
        const allFolders = await prisma.folder.findMany({
            where: { team_id: teamId, is_deleted: false },
            select: { id: true, parent_folder_id: true },
        });

        // getAllDescendantIds gives us every folder inside folderId (recursively)
        const descendantIds = getAllDescendantIds(folderId, allFolders);

        // If the target is one of our descendants → circular reference!
        if (descendantIds.includes(targetParentId)) {
            throw new AppError(
                'Cannot move a folder into its own subfolder — this would create a circular reference',
                400
            );
        }
    }

    // Step 5: perform the move — update parent_folder_id
    const updated = await prisma.folder.update({
        where: { id: folderId },
        data: { parent_folder_id: targetParentId },
    });

    void logActivity({
        teamId,
        userId,
        action: 'folder_moved',
        targetType: 'folder',
        targetId: folderId,
        metadata: {
            folder_name: folder.name,
            fromParentId: folder.parent_folder_id,
            toParentId: targetParentId,
        },
        ip,
        userAgent,
    });

    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.FOLDER_MOVED, {
        folderId: folderId,
        folderName: folder.name,
        fromParentId: folder.parent_folder_id,
        toParentId: targetParentId,
        movedBy: userId
    });

    return updated;
}