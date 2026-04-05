import prisma from '../config/database';
import { Prisma, PrismaClient } from '../generated/prisma';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity, ActivityAction, ActivityTargetType } from '../utils/activityLogger';

/**
 * PURPOSE: Internal helper to snapshot the current state of a File into a FileVersion row.
 * This should be called internally BEFORE any overwrite happens.
 * @param fileId the file being snapshot
 * @param tx optional Prisma transaction client to ensure atomicity
 */
export const createVersion = async (
    fileId: number,
    tx: Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"> = prisma
) => {
    const file = await tx.file.findUnique({
        where: { id: fileId }
    });

    if (!file) {
        throw new Error('File not found during version creation');
    }

    const versionCount = await tx.fileVersion.count({
        where: { file_id: fileId }
    });

    // version_number = count existing + 1
    const nextVersionNumber = versionCount + 1;

    const versionRow = await tx.fileVersion.create({
        data: {
            file_id: file.id,
            version_number: nextVersionNumber,
            storage_path: file.storage_path,
            file_size: file.file_size,
            uploaded_by: file.uploaded_by // The user who uploaded the current active state
        }
    });

    return versionRow;
};

/**
 * Return all historical versions of a file, newest first.
 */
export const listVersions = async (fileId: number, teamId: number, userId: number) => {
    await assertTeamMember(userId, teamId, 'viewer');

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false }
    });

    if (!file) {
        throw new AppError('File not found', 404);
    }

    const versions = await prisma.fileVersion.findMany({
        where: { file_id: fileId },
        orderBy: { version_number: 'desc' }, // Newest versions first
        include: { uploader: { select: { username: true, email: true } } }
    });

    // Map through versions and attach the user data from relation
    const enrichedVersions = versions.map(v => {
        return {
            id: v.id,
            file_id: v.file_id,
            version_number: v.version_number,
            storage_path: v.storage_path,
            file_size: v.file_size,
            uploaded_by: v.uploaded_by,
            created_at: v.created_at,
            uploaded_by_username: v.uploader?.username || 'Unknown User',
            uploaded_by_email: v.uploader?.email
        };
    });

    return enrichedVersions;
};

/**
 * Restore a past version of a file.
 * This captures the CURRENT state as a new version, and then rolls the File record back.
 */
export const restoreVersion = async (fileId: number, versionNumber: number, teamId: number, userId: number) => {
    // Only editors can restore versions
    await assertTeamMember(userId, teamId, 'editor');

    // 1. Verify File exists in this team
    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false }
    });

    if (!file) throw new AppError('File not found', 404);

    // 2. Verify target FileVersion exists
    const targetVersion = await prisma.fileVersion.findFirst({
        where: { file_id: fileId, version_number: versionNumber }
    });

    if (!targetVersion) throw new AppError(`Version ${versionNumber} not found`, 404);

    // If current file already points to this storage path perfectly, no point restoring
    if (file.storage_path === targetVersion.storage_path && file.file_size === targetVersion.file_size) {
        throw new AppError(`File is already at the state of version ${versionNumber}`, 400);
    }

    // Transaction guarantees atomic snapshot + restore
    const updatedFile = await prisma.$transaction(async (tx) => {
        // Snapshot the current file state into the history table
        await createVersion(fileId, tx);

        // Roll the main file object back to the requested historical state.
        // We set uploaded_by to the current user because THEY are technically the 
        // author of the new state (the act of restoring makes them the active updater).
        const restoredFile = await tx.file.update({
            where: { id: fileId },
            data: {
                storage_path: targetVersion.storage_path,
                file_size: targetVersion.file_size,
                uploaded_by: userId,
            }
        });

        // Log the action!
        await tx.activityLog.create({
            data: {
                team_id: teamId,
                user_id: userId,
                action: 'version_restored',
                target_type: 'file',
                target_id: fileId,
                metadata: { restored_to_version: versionNumber }
            }
        });
        return restoredFile;
    });

    return updatedFile;
};
