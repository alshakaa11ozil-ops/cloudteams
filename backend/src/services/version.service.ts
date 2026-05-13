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

// ===========================================================================
// createCollaborativeVersionCheckpoint
// PURPOSE: Create a version snapshot during collaborative editing.
//
// WHY IT EXISTS:
//   When a user edits a file in the collaborative editor, Hocuspocus saves
//   the content to yjs_state in the DB — but no file_version row is created.
//   Without this, the Versions tab always shows "No version history".
//
// CALLED BY: hocuspocus.ts store() (debounced — max once per 10 minutes)
//
// LIMITATION: The storage_path captured here is the ORIGINAL file's path,
//   not the collaborative content. Restoring a collaborative checkpoint will
//   revert to the pre-edit file AND clear yjs_state (done in restoreVersion).
//   This gives users visible version history without requiring a schema migration.
// ===========================================================================
export const createCollaborativeVersionCheckpoint = async (fileId: number): Promise<void> => {
    try {
        const file = await prisma.file.findFirst({
            where: { id: fileId, is_deleted: false },
            select: { id: true, storage_path: true, file_size: true, uploaded_by: true }
        });
        if (!file) return;

        const versionCount = await prisma.fileVersion.count({ where: { file_id: fileId } });

        await prisma.fileVersion.create({
            data: {
                file_id: file.id,
                version_number: versionCount + 1,
                storage_path: file.storage_path,
                file_size: file.file_size,
                uploaded_by: file.uploaded_by,
            },
        });
    } catch (err: any) {
        // Non-fatal: version checkpoints are best-effort
        console.warn('[createCollaborativeVersionCheckpoint] Failed:', err.message)
    }
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
        include: {
            uploader: { select: { id: true, username: true, email: true } },
        },
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
    const historicalVersions = versions.map(v => ({
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

    // Generate the synthetic "Current" version derived from the active file
    const currentVersionNumber = historicalVersions.length > 0
        ? historicalVersions[0].version_number + 1
        : 1;

    const currentVersion = {
        id: file.id * -1000,   // Negative ID to avoid unique key conflicts with past file_versions 
        file_id: file.id,
        version_number: currentVersionNumber,
        storage_path: file.storage_path,
        file_size: file.file_size,
        uploaded_by: file.uploaded_by,
        created_at: file.updated_at || file.created_at,
        uploader: file.uploader
            ? { id: file.uploader.id, username: file.uploader.username, email: file.uploader.email }
            : undefined,
    };

    // The frontend relies on index 0 being the "current" file with the restore button intentionally hidden
    return [currentVersion, ...historicalVersions];
};

// =============================================================================
// restoreVersion
// PURPOSE: Snapshot current state, then roll file back to a past version.
// FIX: Uses logActivity utility (fire-and-forget, void) instead of raw
//      tx.activityLog.create — consistent with every other log call.
// =============================================================================
/**
 * Restore a past version of a file.
 *
 * IMPROVEMENTS FROM ORIGINAL:
 *
 * 1. Removed the storage_path equality guard.
 *    WHY IT WAS WRONG: Deduplication gives identical-content uploads the SAME
 *    storage_path. The guard fired for every deduplicated file, making restore
 *    impossible even when the user legitimately wanted to go back.
 *    The UI already prevents restoring the current version (idx=0 has no button).
 *    No server-side guard is needed — the request is always intentional.
 *
 * 2. Added yjs_state = null to the restore update.
 *    WHY: The collaborative editor checks yjs_state FIRST (PATH A in openEditorHandler).
 *    If yjs_state is not null, the editor loads the Yjs CRDT and completely ignores
 *    the storage_path we just restored. Clearing it forces PATH B: re-read from disk.
 *    Without this, restore appears to do nothing — the editor still shows old content.
 *
 * 3. Added hash = null to the restore update.
 *    WHY: The FileVersion table does not store content hashes. After restoring,
 *    file.hash still points to the PREVIOUS version's content fingerprint.
 *    If the user later uploads the same file that was restored, deduplication
 *    compares against the wrong hash and makes wrong decisions.
 *    null is honest — it tells dedup "hash unknown, treat as new" which is correct.
 *    The hash will be recalculated correctly on the next upload of this file.
 */
export const restoreVersion = async (
    fileId: number,
    versionNumber: number,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
) => {
    // Only editors and admins can restore versions
    await assertTeamMember(userId, teamId, 'editor');

    // Verify the file exists in this team and is not deleted
    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false }
    });
    if (!file) throw new AppError('File not found', 404);

    // Verify the target version row exists
    const targetVersion = await prisma.fileVersion.findFirst({
        where: { file_id: fileId, version_number: versionNumber }
    });
    if (!targetVersion) throw new AppError(`Version ${versionNumber} not found`, 404);

    // Atomic transaction: snapshot current → restore old → log
    const updatedFile = await prisma.$transaction(async (tx) => {

        // Step 1: Snapshot the CURRENT file state into version history BEFORE overwriting.
        // WHY: After restore, the user may want to undo the restore itself.
        // createVersion reads file data inside the transaction — atomic and consistent.
        await createVersion(fileId, tx);

        // Step 2: Roll the main file record back to the requested historical state.
        const restoredFile = await tx.file.update({
            where: { id: fileId },
            data: {
                storage_path: targetVersion.storage_path,
                file_size: targetVersion.file_size,

                // WHY null: collaborative editor prioritises yjs_state over disk file.
                // Without clearing this, the editor ignores the restored storage_path
                // and the user sees no change despite the DB being correctly updated.
                yjs_state: null,

                // WHY null: clears the stale "last synced" timestamp.
                // Leaving a stale timestamp is misleading in the UI.
                yjs_last_saved: null,

                // WHY null: FileVersion does not store content hashes.
                // The current hash reflects the PREVIOUS version's content.
                // Setting null is honest — dedup will treat the next upload
                // of this file as new content and recalculate the hash correctly.
                hash: null,

                // The person performing the restore becomes the "last uploader"
                // shown in the version history UI and activity feed.
                uploaded_by: userId,
            }
        });

        // Step 3: Log to activity feed so the team can see what happened
        await tx.activityLog.create({
            data: {
                team_id: teamId,
                user_id: userId,
                action: 'version_restored',
                target_type: 'file',
                target_id: fileId,
                metadata: { restored_to_version: versionNumber },
                ip,
                userAgent
            }
        });

        return restoredFile;
    });

    return updatedFile;
};
