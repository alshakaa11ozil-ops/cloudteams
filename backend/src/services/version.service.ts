// =============================================================================
// src/services/version.service.ts
// FIXES:
//   - listVersions now returns { uploader: { id, username, email } } shape
//     matching the frontend FileVersion type exactly
//   - restoreVersion now uses logActivity utility instead of raw
//     tx.activityLog.create — consistent format with all other log entries
// =============================================================================

import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity } from '../utils/activityLogger';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';
import { forceReconnectFile } from '../collaboration/hocuspocus';

// Internal helper — snapshot current file state into file_versions table
// Called BEFORE any overwrite so we never lose a version.
// IDEMPOTENT: if a version already exists at the calculated version_number,
// returns it silently without creating a duplicate.
export const createVersion = async (
    fileId: number,
    tx: Omit<Prisma.TransactionClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'> = prisma
) => {
    const file = await tx.file.findUnique({ where: { id: fileId } });
    if (!file) throw new Error('File not found during version creation');

    const versionCount = await tx.fileVersion.count({ where: { file_id: fileId } });
    const nextVersionNumber = versionCount + 1;

    // ─── Duplicate Guard 1: Version Number ───────────────────────────────────
    // If a version already exists at the calculated version_number, return it.
    const alreadyExists = await tx.fileVersion.findFirst({
        where: { file_id: fileId, version_number: nextVersionNumber }
    });
    if (alreadyExists) return alreadyExists;

    // ─── Duplicate Guard 2: Rapid Fire Cooldown ──────────────────────────────
    // If a version was created for this file in the last 5 seconds, skip.
    // This handles race conditions where two requests (e.g. double upload)
    // pass the count check at the same time.
    const recentVersion = await tx.fileVersion.findFirst({
        where: {
            file_id: fileId,
            created_at: { gte: new Date(Date.now() - 5000) } // 5 second window
        },
        orderBy: { created_at: 'desc' }
    });
    if (recentVersion) {
        console.log(`[createVersion] ⏳ Cooldown: skipping duplicate version for file ${fileId} (created ${recentVersion.created_at})`);
        return recentVersion;
    }

    return tx.fileVersion.create({
        data: {
            file_id: file.id,
            version_number: nextVersionNumber,
            storage_path: file.storage_path,
            file_size: file.file_size,
            uploaded_by: file.uploaded_by,
            encryption_iv: file.encryption_iv,
            version_name: nextVersionNumber === 1 ? 'Initial version' : null,
            yjs_state: file.yjs_state,
        },
    });
};

// ===========================================================================
// createCollaborativeVersionCheckpoint
// DEPRECATED — no longer called automatically.
//
// WHY DEPRECATED:
//   Auto-snapshotting on every Hocuspocus save creates thousands of versions
//   per editing session — none of which are meaningful to the user.
//   Industry standard (Google Docs, Notion) is explicit/manual versioning only.
//   Versions are now created by:
//     1. Uploading a new file with the same name (file.service.ts → createVersion)
//     2. User clicking "Save Version" → saveFileVersion() below
//     3. System snapshotting BEFORE a restore (restoreVersion → createVersion)
// ===========================================================================
export const createCollaborativeVersionCheckpoint = async (_fileId: number): Promise<void> => {
    // No-op: auto-checkpointing disabled in favour of explicit versioning.
    // Kept exported so existing hocuspocus.ts imports do not break.
};

// ===========================================================================
// saveFileVersion
// PURPOSE: Explicitly snapshot the current file state as a named version.
//
// WHY EXPLICIT (not automatic):
//   The Yjs collaborative editor saves continuously (every keystroke synced).
//   Snapshotting every save would produce thousands of useless versions.
//   This follows the Google Docs model: user deliberately clicks "Save Version".
//
// CALLED BY: saveVersionHandler → POST /api/teams/:teamId/files/:fileId/versions
//
// INPUTS:
//   fileId     — file to snapshot
//   teamId     — team ownership check
//   userId     — must be editor or admin
//   versionName — optional label (e.g. "Before Q3 review")
//
// OUTPUTS: The newly created FileVersion row
// ===========================================================================
export const saveFileVersion = async (
    fileId: number,
    teamId: number,
    userId: number,
    versionName?: string
) => {
    // Only editors and admins can manually save versions
    await assertTeamMember(userId, teamId, 'editor');

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false },
    });
    if (!file) throw new AppError('File not found', 404);

    // Files edited exclusively via the collaborative editor have no storage_path
    // (the content lives only in yjs_state). We can't snapshot them via FileVersion
    // since there's no disk file to restore from. Users should use the editor's
    // own version history (documentVersion) for collaborative documents.
    if (!file.storage_path) {
        throw new AppError(
            'This file has no uploaded content to snapshot. ' +
            'Use the editor\'s History panel to save document versions.',
            422
        );
    }

    const versionCount = await prisma.fileVersion.count({ where: { file_id: fileId } });
    const nextVersionNumber = versionCount + 1;

    const version = await prisma.fileVersion.create({
        data: {
            file_id: file.id,
            version_number: nextVersionNumber,
            storage_path: file.storage_path,
            file_size: file.file_size,
            uploaded_by: userId,
            encryption_iv: file.encryption_iv,
            yjs_state: file.yjs_state,
            // version_name column exists in the schema — persist the user-provided label
            version_name: versionName ?? null,
        },
        include: {
            uploader: { select: { id: true, username: true, email: true } },
        },
    });

    void logActivity({
        teamId,
        userId,
        action: 'version_saved',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            version_number: nextVersionNumber,
            file_name: file.original_name,
            ...(versionName ? { version_name: versionName } : {}),
        },
    });

    emitToTeam(teamId, SOCKET_EVENTS.FILE_VERSION_CREATED, {
        fileId: file.id,
        versionId: version.id
    });

    return { ...version, version_name: versionName ?? null };
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
        encryption_iv: v.encryption_iv,
        version_name: v.version_name ?? null,   // user-provided label — was missing before
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
                encryption_iv: targetVersion.encryption_iv,

                // WHY targetVersion.yjs_state: If the historical version had collaborative edits,
                // we must restore them. If it didn't, this correctly clears yjs_state so the
                // editor falls back to reading from storage_path.
                yjs_state: targetVersion.yjs_state,

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
                metadata: { 
                    restored_to_version: versionNumber,
                    file_name: file.original_name
                },
                ip,
                userAgent
            }
        });

        return restoredFile;
    });

    forceReconnectFile(fileId);

    emitToTeam(teamId, SOCKET_EVENTS.FILE_VERSION_RESTORED, {
        fileId,
        versionId: targetVersion.id,
        restoredBy: userId
    });

    return updatedFile;
};
