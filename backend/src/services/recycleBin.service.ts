import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';

/**
 * List all soft-deleted files for a team.
 * @param teamId Team ID
 * @param userId Requesting user ID
 */
export const listDeletedFiles = async (teamId: number, userId: number) => {
    // Verify membership — any member can view the recycle bin
    await assertTeamMember(userId, teamId, 'viewer');

    const files = await prisma.file.findMany({
        where: {
            team_id: teamId,
            is_deleted: true,
        },
        include: {
            uploader: {
                select: { id: true, username: true, email: true },
            },
        },
        orderBy: {
            deleted_at: 'desc',
        },
    });

    return files;
};
/**
 * Unified View: Return ALL deleted files and folders for the team.
 * @param teamId Team ID
 * @param userId Requesting user ID
 */
export const getUnifiedRecycleBin = async (teamId: number, userId: number) => {
    await assertTeamMember(userId, teamId, 'viewer');

    const [files, folders] = await Promise.all([
        listDeletedFiles(teamId, userId),
        listDeletedFolders(teamId, userId)
    ]);

    return { 
        files, 
        folders, 
        total: files.length + folders.length 
    };
};

/**
 * Restore a soft-deleted file, removing it from the recycle bin.
 * @param fileId File ID to restore
 * @param teamId Team ID the file belongs to
 * @param userId Requesting user ID
 */
export const restoreFile = async (fileId: number, teamId: number, userId: number) => {
    // Only editors/admins can restore a file
    await assertTeamMember(userId, teamId, 'editor');

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: true },
        include: { folder: true } // Fetch the folder to check if it's also deleted
    });

    if (!file) {
        throw new AppError('File not found in recycle bin', 404);
    }

    // SAFETY CHECK: If the parent folder is currently deleted, moving the file back
    // into it will make the file invisible to the user. We orphan it to the root instead.
    let finalFolderId = file.folder_id;
    if (file.folder && file.folder.is_deleted) {
        finalFolderId = null;
    }

    const updatedFile = await prisma.file.update({
        where: { id: fileId },
        data: {
            is_deleted: false,
            deleted_at: null,
            folder_id: finalFolderId,
        },
    });

    return updatedFile;
};

// ─────────────────────────────────────────────
// FOLDER RECYCLE BIN LOGIC
// ─────────────────────────────────────────────

/**
 * Helper: Find all matching descendant IDs recursively.
 */
function getAllDescendantIds(
    folderId: number,
    allFolders: Array<{ id: number; parent_folder_id: number | null }>
): number[] {
    const result: number[] = [];
    const children = allFolders.filter((f) => f.parent_folder_id === folderId);
    for (const child of children) {
        result.push(child.id);
        result.push(...getAllDescendantIds(child.id, allFolders));
    }
    return result;
}

/**
 * List all soft-deleted folders for a team.
 * @param teamId Team ID
 * @param userId Requesting user ID
 */
export const listDeletedFolders = async (teamId: number, userId: number) => {
    await assertTeamMember(userId, teamId, 'viewer');

    const folders = await prisma.folder.findMany({
        where: {
            team_id: teamId,
            is_deleted: true,
            // Only fetch folders that were at the root WHEN they were deleted,
            // so the user sees a clean top-level view of the recycle bin.
            // (If they want to see inside a deleted folder, they use the new endpoint)
            // Wait, actually, let's just return all deleted folders here, or we can filter.
            // For now, let's keep it simple: return all deleted folders.
        },
        orderBy: {
            deleted_at: 'desc',
        },
    });

    return folders;
};

/**
 * Open a specific soft-deleted folder and see what is inside it.
 * @param folderId The soft-deleted folder to open
 * @param teamId Team ID
 * @param userId Requesting user ID
 */
export const getDeletedFolderContents = async (folderId: number, teamId: number, userId: number) => {
    await assertTeamMember(userId, teamId, 'viewer');

    // Make sure the requested folder actually exists and is deleted
    const parentFolder = await prisma.folder.findFirst({
        where: { id: folderId, team_id: teamId, is_deleted: true }
    });

    if (!parentFolder) {
        throw new AppError('Deleted folder not found', 404);
    }

    // Get deleted sub-folders
    const childFolders = await prisma.folder.findMany({
        where: { team_id: teamId, parent_folder_id: folderId, is_deleted: true },
        orderBy: { deleted_at: 'desc' }
    });

    // Get deleted files
    const childFiles = await prisma.file.findMany({
        where: { team_id: teamId, folder_id: folderId, is_deleted: true },
        include: {
            uploader: { select: { id: true, username: true, email: true } },
        },
        orderBy: { deleted_at: 'desc' }
    });

    return {
        folder: parentFolder,
        folders: childFolders,
        files: childFiles
    };
};

/**
 * Restore a soft-deleted folder AND all files/sub-folders inside it.
 * @param folderId Folder ID to restore
 * @param teamId Team ID the folder belongs to
 * @param userId Requesting user ID
 */
export const restoreFolder = async (folderId: number, teamId: number, userId: number) => {
    // Only editors/admins can restore a folder
    await assertTeamMember(userId, teamId, 'editor');

    const folder = await prisma.folder.findFirst({
        where: { id: folderId, team_id: teamId, is_deleted: true },
        include: { parent: true }
    });

    if (!folder) {
        throw new AppError('Folder not found in recycle bin', 404);
    }

    // 1. Find all deleted descendants recursively so we restore the whole tree
    const allDeletedFolders = await prisma.folder.findMany({
        where: { team_id: teamId, is_deleted: true },
        select: { id: true, parent_folder_id: true },
    });

    const descendantIds = getAllDescendantIds(folderId, allDeletedFolders);
    const allFolderIdsToRestore = [folderId, ...descendantIds];

    // 2. Safety Check: If the parent folder of THIS target folder is still deleted,
    // we must orphan this restored hierarchy to the root so it's visible.
    let finalParentFolderId = folder.parent_folder_id;
    if (folder.parent && folder.parent.is_deleted) {
        finalParentFolderId = null;
    }

    // 3. Atomically restore all folders and files inside them
    const [updatedFolders, updatedFiles, updatedRootFolder] = await prisma.$transaction([
        // Restore all the folders
        prisma.folder.updateMany({
            where: { id: { in: allFolderIdsToRestore } },
            data: { is_deleted: false, deleted_at: null },
        }),
        // Restore all files living inside those folders
        prisma.file.updateMany({
            where: {
                team_id: teamId,
                folder_id: { in: allFolderIdsToRestore },
                is_deleted: true,
            },
            data: { is_deleted: false, deleted_at: null },
        }),
        // Assign the correct parent to the very top folder we restored
        prisma.folder.update({
            where: { id: folderId },
            data: { parent_folder_id: finalParentFolderId }
        })
    ]);

    return {
        message: 'Folder and contents restored successfully',
        restoredFolders: updatedFolders.count,
        restoredFiles: updatedFiles.count
    };
};

// ─────────────────────────────────────────────
// PERMANENT DELETION (EMPTY BIN)
// ─────────────────────────────────────────────

/**
 * Internal Helper: The actual logic for physical deletion and database removal.
 * Assumes the caller has already verified administrative permissions.
 */
async function performHardDeleteFile(fileId: number, teamId: number) {
    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: true }
    });

    if (!file) {
        throw new AppError('File not found in recycle bin', 404);
    }

    const storagePath = file.storage_path;

    // Remove from database forever
    await prisma.file.delete({ where: { id: fileId } });

    // DEDUPLICATION CHECK: Does ANY other File or FileVersion use this exact storage path?
    const otherFilesUsingPath = await prisma.file.count({ where: { storage_path: storagePath } });
    const versionsUsingPath = await prisma.fileVersion.count({ where: { storage_path: storagePath } });

    if (otherFilesUsingPath === 0 && versionsUsingPath === 0) {
        // Absolutely no one is using this physical file. Delete it from the hard drive.
        const absolutePath = path.resolve(storagePath);
        if (fs.existsSync(absolutePath)) {
            try {
                fs.unlinkSync(absolutePath);
            } catch (err) {
                console.error(`Failed to delete physical file at ${absolutePath}`, err);
            }
        }
    }
}

/**
 * Permanently deletes a file from the database and physically from disk (if no other DB records share it).
 */
export const hardDeleteFile = async (fileId: number, teamId: number, userId: number) => {
    // Only admins can permanently delete
    await assertTeamMember(userId, teamId, 'admin');

    await performHardDeleteFile(fileId, teamId);

    return { message: 'File permanently deleted' };
};

/**
 * Permanently delete a single folder and all of its contents.
 */
export const hardDeleteFolder = async (folderId: number, teamId: number, userId: number) => {
    // Only admins can permanently delete
    await assertTeamMember(userId, teamId, 'admin');

    const folder = await prisma.folder.findFirst({
        where: { id: folderId, team_id: teamId, is_deleted: true }
    });

    if (!folder) {
        throw new AppError('Folder not found in recycle bin', 404);
    }

    // Since this folder contains other deleted files/folders, we should just find them 
    // and run `performHardDeleteFile` on each file for safety, then kill the folders.
    const allDeletedFolders = await prisma.folder.findMany({
        where: { team_id: teamId, is_deleted: true },
        select: { id: true, parent_folder_id: true },
    });
    
    const descendantIds = getAllDescendantIds(folderId, allDeletedFolders);
    const folderIdsToDelete = [folderId, ...descendantIds];

    // Get all files inside these folders
    const filesToDelete = await prisma.file.findMany({
        where: { team_id: teamId, folder_id: { in: folderIdsToDelete }, is_deleted: true },
        select: { id: true }
    });

    // 1. Hard delete all files (which handles physical unlinking securely)
    // We use the helper to avoid re-checking permissions inside the loop.
    for (const fileRecord of filesToDelete) {
        await performHardDeleteFile(fileRecord.id, teamId);
    }

    // 2. Hard delete the folders from the DB
    const deletedFolders = await prisma.folder.deleteMany({
        where: { id: { in: folderIdsToDelete } }
    });

    return { 
        message: 'Folder hierarchy permanently deleted',
        deletedFolders: deletedFolders.count,
        deletedFiles: filesToDelete.length
    };
};

/**
 * Empty the entire recycle bin for a team (Permanently delete everything).
 */
export const emptyRecycleBin = async (teamId: number, userId: number) => {
    await assertTeamMember(userId, teamId, 'admin');

    // Find ALL deleted files for the entire team
    const allDeletedFiles = await prisma.file.findMany({
        where: { team_id: teamId, is_deleted: true },
        select: { id: true }
    });

    // Bulk delete files using the optimized helper
    for (const file of allDeletedFiles) {
        await performHardDeleteFile(file.id, teamId);
    }

    // Now permanently delete ALL deleted folders for the team
    const deletedFolders = await prisma.folder.deleteMany({
        where: { team_id: teamId, is_deleted: true }
    });

    return {
        message: 'Recycle bin emptied successfully',
        deletedFiles: allDeletedFiles.length,
        deletedFolders: deletedFolders.count
    };
};
