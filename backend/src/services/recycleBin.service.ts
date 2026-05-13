import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity, ActivityAction } from '../utils/activityLogger';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';
import { DocumentSummary } from './document.service';
import { deleteFile as r2Delete } from './storage.service';


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
export const listDeletedDocuments = async (teamId: number, userId: number): Promise<DocumentSummary[]> => {
    await assertTeamMember(userId, teamId, 'viewer');
    const docs = await prisma.documents.findMany({
        where: { team_id: teamId, is_deleted: true },
        include: { users: { select: { id: true, username: true, email: true, full_name: true } } },
        orderBy: { deleted_at: 'desc' },
    });

    return docs.map(d => ({
        id: d.id,
        title: d.title,
        folderId: d.folder_id,
        createdBy: d.created_by,
        creatorName: d.users.full_name ?? d.users.username ?? null,
        lastSaved: d.last_saved,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        deletedAt: d.deleted_at,
    }));
};

/**
 * Unified View: Return ALL deleted files, documents, and folders for the team.
 * @param teamId Team ID
 * @param userId Requesting user ID
 */
export const getUnifiedRecycleBin = async (teamId: number, userId: number) => {
    await assertTeamMember(userId, teamId, 'viewer');

    const [files, folders, documents] = await Promise.all([
        listDeletedFiles(teamId, userId),
        listDeletedFolders(teamId, userId),
        listDeletedDocuments(teamId, userId)
    ]);

    return {
        files,
        folders,
        documents,
        total: files.length + folders.length + documents.length
    };
};

/**
 * Restore a soft-deleted file, removing it from the recycle bin.
 * @param fileId File ID to restore
 * @param teamId Team ID the file belongs to
 * @param userId Requesting user ID
 */
export const restoreFile = async (
    fileId: number,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) => {
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

    // Audit: fire-and-forget — log that this user restored the file from the bin.
    // metadata includes whether it landed back in its original folder or was orphaned to root.
    void logActivity({
        teamId,
        userId,
        action: 'file_restored',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            file_name: file.original_name,
            restoredToFolderId: finalFolderId,            // null = root level
            orphanedToRoot: finalFolderId !== file.folder_id, // true if parent was deleted
        },
        ip,
        userAgent,
    });

    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.FILE_RESTORED, {
        fileId: fileId,
        fileName: file.original_name,
        restoredBy: userId
    });

    return updatedFile;

};

export const restoreDocument = async (
    documentId: number,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) => {
    // Only editors/admins can restore a document
    await assertTeamMember(userId, teamId, 'editor');

    const document = await prisma.documents.findFirst({
        where: { id: documentId, team_id: teamId, is_deleted: true },
        include: { folders: true }
    });

    if (!document) {
        throw new AppError('Document not found in recycle bin', 404);
    }

    let finalFolderId = document.folder_id;
    if (document.folders && document.folders.is_deleted) {
        finalFolderId = null;
    }

    const updatedDocument = await prisma.documents.update({
        where: { id: documentId },
        data: {
            is_deleted: false,
            deleted_at: null,
            folder_id: finalFolderId,
        },
    });

    void logActivity({
        teamId,
        userId,
        action: 'document_restored' as ActivityAction,
        targetType: 'document',
        targetId: documentId,
        metadata: {
            document_title: document.title,
            restoredToFolderId: finalFolderId,
            orphanedToRoot: finalFolderId !== document.folder_id,
        },
        ip,
        userAgent,
    });

    return updatedDocument;
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

    // Get deleted documents
    const childDocuments = await prisma.documents.findMany({
        where: { team_id: teamId, folder_id: folderId, is_deleted: true },
        include: { users: { select: { id: true, username: true, email: true } } },
        orderBy: { deleted_at: 'desc' }
    });

    return {
        folder: parentFolder,
        folders: childFolders,
        files: childFiles,
        documents: childDocuments
    };
};

/**
 * Restore a soft-deleted folder AND all files/sub-folders inside it.
 * @param folderId Folder ID to restore
 * @param teamId Team ID the folder belongs to
 * @param userId Requesting user ID
 */
export const restoreFolder = async (
    folderId: number,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) => {
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
        // Restore all documents living inside those folders
        prisma.documents.updateMany({
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

    const result = {
        message: 'Folder and contents restored successfully',
        restoredFolders: updatedFolders.count,
        restoredFiles: updatedFiles.count,
    };

    // Audit: fire-and-forget — records how many folders/files were recovered.
    // 'folder_restored' is distinct from 'file_restored' so the feed can group them.
    void logActivity({
        teamId,
        userId,
        action: 'folder_restored',
        targetType: 'folder',
        targetId: folderId,
        metadata: {
            folder_name: folder.name,
            restoredFolders: updatedFolders.count,
            restoredFiles: updatedFiles.count,
            orphanedToRoot: finalParentFolderId !== folder.parent_folder_id, // reparented?
        },
        ip,
        userAgent,
    });

    // Real-time notification via helper
    // We send FOLDER_CREATED because the frontend usually treats a restored folder 
    // as a new addition to the active view.
    emitToTeam(teamId, SOCKET_EVENTS.FOLDER_CREATED, {
        folder: updatedRootFolder as unknown as Record<string, unknown>,
        restoredBy: userId
    });

    return result;

};

// ─────────────────────────────────────────────
// PERMANENT DELETION (EMPTY BIN)
// ─────────────────────────────────────────────

/**
 * Internal Helper: The actual logic for physical deletion and database removal.
 * Assumes the caller has already verified administrative permissions.
 */
// src/services/recycleBin.service.ts
// ─── ONLY REPLACE THIS FUNCTION ───────────────────────────────────────────────

/**
 * Internal Helper: The actual logic for R2 deletion and database removal.
 * Assumes the caller has already verified administrative permissions.
 *
 * PURPOSE: Permanently remove a file from the database AND from R2 storage,
 *          but ONLY delete the R2 object if no other DB record references it.
 *
 * WHY THE DEDUP CHECK:
 *   Deduplication means two DB records can point at the same R2 object key
 *   (storage_path). If we deleted the R2 object whenever any record was
 *   removed, the second record would point at a ghost — R2 returns 404,
 *   download fails. We count ALL references (files + versions) before
 *   touching R2.
 *
 * NOTE: We delete the DB record FIRST, then check the count.
 *   This means the count query no longer sees the deleted record —
 *   so a count of 0 means "truly nobody else uses this object".
 *   If we checked BEFORE deleting, the count would include the record
 *   we're about to remove and we'd always get count ≥ 1, never deleting R2.
 */
async function performHardDeleteFile(fileId: number, teamId: number) {
    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: true },
    });

    if (!file) {
        throw new AppError('File not found in recycle bin', 404);
    }

    // Save the storage_path BEFORE deleting — we need it for the R2 check below.
    // After prisma.file.delete(), the `file` object still has the value in memory,
    // but saving it explicitly makes the intent clear.
    const storagePath = file.storage_path;

    // Step 1: Remove from database forever.
    await prisma.file.delete({ where: { id: fileId } });

    // Step 2: DEDUPLICATION CHECK — does any other record still reference this R2 object?
    // We check both files AND fileVersions because:
    //   - A version snapshot may still point at the same object key
    //   - Deleting R2 while a version references it would break version restore
    const otherFilesUsingPath = await prisma.file.count({
        where: { storage_path: storagePath },
    });
    const versionsUsingPath = await prisma.fileVersion.count({
        where: { storage_path: storagePath },
    });

    if (otherFilesUsingPath === 0 && versionsUsingPath === 0) {
        // Nobody else references this R2 object. Safe to delete.
        // r2Delete is already imported at the top of your file.
        try {
            await r2Delete(storagePath);
        } catch (err) {
            // R2 deletion failed — log it but don't throw.
            // The DB record is already gone. A failed R2 delete leaves an
            // orphaned object (wasted storage) but doesn't corrupt data.
            // In production you'd add this to a cleanup queue.
            console.error(
                `[RecycleBin] Failed to delete R2 object at key "${storagePath}":`,
                err
            );
        }
    }
    // If count > 0: another record still needs this R2 object — leave it alone.
}
/**
 * Permanently deletes a single file from the recycle bin.
 * Public wrapper around performHardDeleteFile that adds permission check + audit log.
 * Called by hardDeleteFileHandler in the controller.
 */
export const hardDeleteFile = async (
    fileId: number,
    teamId: number,
    userId: number
): Promise<{ message: string }> => {
    // Only admins can permanently delete — same rule as hardDeleteFolder
    await assertTeamMember(userId, teamId, 'admin');

    // Fetch name before deletion for the audit log — after delete it's gone
    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: true },
        select: { original_name: true },
    });

    if (!file) {
        throw new AppError('File not found in recycle bin', 404);
    }

    // performHardDeleteFile handles: DB delete + dedup check + R2 delete
    await performHardDeleteFile(fileId, teamId);

    void logActivity({
        teamId,
        userId,
        action: 'file_deleted',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            file_name: file.original_name,
            permanent: true,
        },
    });

    return { message: 'File permanently deleted' };
};
/**
 * Permanently deletes a file from the database and physically from disk (if no other DB records share it).
 */
// --- REPLACE permanentDelete in recycleBin.service.ts ---
// PURPOSE: Delete the DB record AND the R2 object.
// WHY BOTH: Soft delete only hides the DB record. Permanent delete must
// also free the R2 storage, otherwise you accumulate orphaned objects.
// NOTE: Only delete R2 object if no other file record uses the same hash
// (deduplication means multiple DB records may share one R2 object).



async function performHardDeleteDocument(documentId: number, teamId: number) {
    const document = await prisma.documents.findFirst({
        where: { id: documentId, team_id: teamId, is_deleted: true }
    });

    if (!document) {
        throw new AppError('Document not found in recycle bin', 404);
    }

    await prisma.documents.delete({ where: { id: documentId } });
}

export const hardDeleteDocument = async (documentId: number, teamId: number, userId: number) => {
    await assertTeamMember(userId, teamId, 'admin');

    const document = await prisma.documents.findFirst({
        where: { id: documentId, team_id: teamId, is_deleted: true },
        select: { title: true }
    });

    if (!document) {
        throw new AppError('Document not found in recycle bin', 404);
    }

    await performHardDeleteDocument(documentId, teamId);

    void logActivity({
        teamId,
        userId,
        action: 'document_deleted' as ActivityAction,
        targetType: 'document',
        targetId: documentId,
        metadata: {
            document_title: document.title,
            permanent: true
        },
    });

    return { message: 'Document permanently deleted' };
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

    // Get all documents inside these folders
    const documentsToDelete = await prisma.documents.findMany({
        where: { team_id: teamId, folder_id: { in: folderIdsToDelete }, is_deleted: true },
        select: { id: true }
    });

    // 1. Hard delete all files and documents
    for (const fileRecord of filesToDelete) {
        await performHardDeleteFile(fileRecord.id, teamId);
    }
    for (const docRecord of documentsToDelete) {
        await performHardDeleteDocument(docRecord.id, teamId);
    }

    // 2. Hard delete the folders from the DB
    const deletedFolders = await prisma.folder.deleteMany({
        where: { id: { in: folderIdsToDelete } }
    });

    // Audit log
    void logActivity({
        teamId,
        userId,
        action: 'folder_deleted',
        targetType: 'folder',
        targetId: folderId,
        metadata: {
            folder_name: folder.name,
            permanent: true,
            deletedFolders: deletedFolders.count,
            deletedFiles: filesToDelete.length
        },
    });

    return {
        message: 'Folder hierarchy permanently deleted',
        deletedFolders: deletedFolders.count,
        deletedFiles: filesToDelete.length,
        deletedDocuments: documentsToDelete.length
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

    const allDeletedDocuments = await prisma.documents.findMany({
        where: { team_id: teamId, is_deleted: true },
        select: { id: true }
    });

    for (const doc of allDeletedDocuments) {
        await performHardDeleteDocument(doc.id, teamId);
    }

    // Now permanently delete ALL deleted folders for the team
    const deletedFolders = await prisma.folder.deleteMany({
        where: { team_id: teamId, is_deleted: true }
    });

    // Audit log
    void logActivity({
        teamId,
        userId,
        action: 'file_deleted',
        targetType: 'file',
        targetId: 0, // 0 for bulk action
        metadata: {
            action_name: 'Empty Recycle Bin',
            deletedFiles: allDeletedFiles.length,
            deletedFolders: deletedFolders.count,
            permanent: true
        },
    });

    return {
        message: 'Recycle bin emptied successfully',
        deletedFiles: allDeletedFiles.length,
        deletedFolders: deletedFolders.count
    };
};
