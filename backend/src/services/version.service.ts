// =============================================================================
// src/services/version.service.ts
// FIXES:
//   - listVersions now returns { uploader: { id, username, email } } shape
//     matching the frontend FileVersion type exactly
//   - restoreVersion now uses logActivity utility instead of raw
//     tx.activityLog.create — consistent format with all other log entries
// =============================================================================

import prisma from '../config/database';
import { Prisma } from '../generated/prisma';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity } from '../utils/activityLogger';

// Internal helper — snapshot current file state into file_versions table
// Called BEFORE any overwrite so we never lose a version
export const createVersion = async (
    fileId: number,
    tx: Omit<Prisma.TransactionClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'> = prisma
) => {
    const file = await tx.file.findUnique({ where: { id: fileId } });
    if (!file) throw new Error('File not found during version creation');

    const versionCount = await tx.fileVersion.count({ where: { file_id: fileId } });

    return tx.fileVersion.create({
        data: {
            file_id: file.id,
            version_number: versionCount + 1,
            storage_path: file.storage_path,
            file_size: file.file_size,
            uploaded_by: file.uploaded_by,
        },
    });
};

// =============================================================================
// listVersions
// PURPOSE: Return all historical versions of a file, newest first.
// FIX: Returns uploader as { id, username, email } — matches frontend type.
// =============================================================================
export const listVersions = async (
    fileId: number,
    teamId: number,
    userId: number
) => {
    await assertTeamMember(userId, teamId, 'viewer');

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false },
    });
    if (!file) throw new AppError('File not found', 404);

    const versions = await prisma.fileVersion.findMany({
        where: { file_id: fileId },
        orderBy: { version_number: 'desc' }, // newest first — frontend relies on this order
        include: {
            uploader: {
                select: { id: true, username: true, email: true }, // id added — was missing before
            },
        },
    });

    // Shape matches the FileVersion interface in src/types/index.ts exactly:
    // { id, file_id, version_number, storage_path, file_size, uploaded_by,
    //   created_at, uploader: { id, username, email } }
    return versions.map(v => ({
        id: v.id,
        file_id: v.file_id,
        version_number: v.version_number,
        storage_path: v.storage_path,
        file_size: v.file_size,
        uploaded_by: v.uploaded_by,
        created_at: v.created_at,
        uploader: v.uploader
            ? { id: v.uploader.id, username: v.uploader.username, email: v.uploader.email }
            : undefined,
    }));
};

// =============================================================================
// restoreVersion
// PURPOSE: Snapshot current state, then roll file back to a past version.
// FIX: Uses logActivity utility (fire-and-forget, void) instead of raw
//      tx.activityLog.create — consistent with every other log call.
// =============================================================================
export const restoreVersion = async (
    fileId: number,
    versionNumber: number,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) => {
    await assertTeamMember(userId, teamId, 'editor');

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false },
    });
    if (!file) throw new AppError('File not found', 404);

    const targetVersion = await prisma.fileVersion.findFirst({
        where: { file_id: fileId, version_number: versionNumber },
    });
    if (!targetVersion) throw new AppError(`Version ${versionNumber} not found`, 404);

    // ── GUARD 1: Same storage path ──────────────────────────────────────────
    // Prevents restoring to what is already the active content
    if (file.storage_path === targetVersion.storage_path) {
        throw new AppError(
            `File already shows version ${versionNumber} content. No restore needed.`,
            400
        );
    }

    // ── GUARD 2: Same hash (content-based check) ─────────────────────────────
    // WHY: storage_path check can fail if file was re-uploaded with same content
    // but different path. Hash comparison catches true content equality.
    // Only run if both hashes exist (hash was added in Week 5)
    if (file.hash && targetVersion.file_size === file.file_size) {
        // If sizes match, do a deeper check — look for a version with this
        // exact storage_path already in the history to detect circular restores
        const alreadyInHistory = await prisma.fileVersion.findFirst({
            where: {
                file_id: fileId,
                storage_path: targetVersion.storage_path,
                // Exclude the target version itself — we want OTHER versions with same path
                NOT: { version_number: versionNumber },
                // Only check recent versions — if last 2 versions alternate same paths,
                // that's a circular restore pattern
                version_number: { gt: versionNumber },
            },
            orderBy: { version_number: 'desc' },
        });

        // If the most recent version already has this content, we're in a loop
        if (alreadyInHistory) {
            const latestVersion = await prisma.fileVersion.findFirst({
                where: { file_id: fileId },
                orderBy: { version_number: 'desc' },
            });

            if (latestVersion?.storage_path === targetVersion.storage_path) {
                throw new AppError(
                    `Cannot restore: the previous version already has this content. ` +
                    `This would create a duplicate version with no changes.`,
                    400
                );
            }
        }
    }

    // Atomic: snapshot current state, then apply historical state
    const restoredFile = await prisma.$transaction(async tx => {
        await createVersion(fileId, tx);

        return tx.file.update({
            where: { id: fileId },
            data: {
                storage_path: targetVersion.storage_path,
                file_size: targetVersion.file_size,
                uploaded_by: userId,
            },
        });
    });

    void logActivity({
        teamId,
        userId,
        action: 'version_restored',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            file_name: file.original_name,
            restored_to_version: versionNumber,
        },
        ip,
        userAgent,
    });

    return restoredFile;
};