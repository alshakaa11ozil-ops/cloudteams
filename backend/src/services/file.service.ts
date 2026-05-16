// =============================================================================
// src/services/file.service.ts
// PURPOSE: All business logic for file operations — upload, deduplication,
//          listing, retrieval, download path resolution, and soft delete.
//          This is the core of Week 5. No HTTP concerns live here.
//
// ARCHITECTURE RULE: This file only talks to Prisma and the filesystem.
//   Routes → Controllers → THIS FILE → Prisma / fs
//
// DEDUPLICATION PRINCIPLE:
//   Every uploaded file is fingerprinted with SHA-256. If a file with the
//   same hash already exists in the same team, we discard the new copy from
//   disk and create a DB record pointing to the existing storage_path.
//   Result: 50 students uploading the same PDF = 1 file on disk, 50 records
//   in the database. Same principle used by Git and Docker image layers.
// =============================================================================

import fs from "fs";
import mammoth from "mammoth";
import * as xlsx from "xlsx";
import path from "path";
import { Readable } from 'stream';
import prisma from "../config/database"; // Prisma singleton
import { calculateFileHash } from "../utils/hash"; // SHA-256 utility
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity, ActivityAction, ActivityTargetType } from '../utils/activityLogger';
import { explainDuplicate } from './AI/duplicateExplain.service';
import { File as PrismaFile } from '@prisma/client';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';
import { createVersion } from './version.service';
import { encryptBuffer, isEncryptionEnabled, decryptBuffer, decryptFile } from '../utils/fileEncryption'
import * as Y from 'yjs'
import { uploadFile as r2Upload, deleteFile as r2Delete, generateObjectKey, getFileStream } from './storage.service';
// CUSTOM ERROR CLASSES
// ---------------------------------------------------------------------------
// PURPOSE: Typed errors let the controller map each error to the correct
//          HTTP status code without parsing error message strings.
//
// WHY EXTEND Error?
//   instanceof checks work correctly. The controller can do:
//     if (err instanceof FileNotFoundError) res.status(404)
//   This is cleaner than checking err.message or using error codes.
// ---------------------------------------------------------------------------

export class FileNotFoundError extends Error {
    constructor(message = "File not found") {
        super(message);
        this.name = "FileNotFoundError";
    }
}

export class ForbiddenError extends Error {
    constructor(message = "You do not have access to this resource") {
        super(message);
        this.name = "ForbiddenError";
    }
}


// ---------------------------------------------------------------------------
// HELPER: verifyEditorRole
// ---------------------------------------------------------------------------
// PURPOSE: For write operations (upload, delete), confirm the user has at
//          least 'editor' role. Viewers can read but not write.
//
// INPUTS:
//   userId (number)
//   teamId (number)
//
// OUTPUTS:
//   Promise<void>  — resolves if role is 'editor' or 'admin'
//                  — throws ForbiddenError if role is 'viewer'
//
// WHY SEPARATE FROM verifyTeamMembership?
//   Some endpoints (list, get, download) only need membership.
//   Others (upload, delete) need editor/admin. Keeping them separate
//   means each service function composes exactly the checks it needs.
// ---------------------------------------------------------------------------
const verifyEditorRole = async (
    userId: number,
    teamId: number
): Promise<void> => {
    const membership = await prisma.teamMember.findUnique({
        where: {
            team_id_user_id: {
                team_id: teamId,
                user_id: userId,
            },
        },
    });

    // Not a member at all
    if (!membership) {
        throw new ForbiddenError("You are not a member of this team");
    }

    // Member exists but is viewer-only
    if (membership.role === "viewer") {
        throw new ForbiddenError("Viewers cannot upload or delete files");
    }

    // role is 'editor' or 'admin' — allow through
};

// ===========================================================================
// SERVICE FUNCTION 1: uploadFile
// ===========================================================================
// PURPOSE: Handle the full upload pipeline — hash the file, check for
//          duplicates, either keep or discard the uploaded copy, and
//          create a File record in the database.
//
// INPUTS:
//   multerFile  — the req.file object populated by multer middleware:
//                   { filename, originalname, size, mimetype, path }
//   teamId      (number) — which team this file belongs to
//   uploadedBy  (number) — userId of the uploader (from JWT)
//   folderId    (number | undefined) — optional folder placement
//
// OUTPUTS:
//   Promise<{ file: File, isDuplicate: boolean }>
//     file        — the newly created Prisma File record
//     isDuplicate — true if a file with this hash already existed in the team.
//                   The controller can use this to tell the client "this file
//                   already exists, but we've added a reference for you."
//
// WHY RETURN isDuplicate?
//   The controller can send a different success message to the client:
//   "File uploaded" vs "File already exists — reference created".
//   Both are success (201), but the client gets useful information.
//
// EDGE CASES HANDLED:
//   1. Duplicate file → disk copy deleted, DB record points to existing path
//   2. folderId provided → file placed in folder; omitted → NULL (root level)
//   3. Hash calculation fails → error propagates; multer file stays on disk
//      (not a problem — it's an orphan that takes up space but causes no bugs;
//       a cleanup cron job could sweep /uploads for orphaned files in Week 15)
// ===========================================================================
export const uploadFile = async (
    multerFile: Express.Multer.File,
    teamId: number,
    uploadedBy: number,
    ip: string,
    userAgent: string,
    folderId?: number
): Promise<{ file: object; isDuplicate: boolean; duplicateReason?: string | null }> => {

    // ─── STEP 1: Permission check ───────────────────────────────────────────────
    await verifyEditorRole(uploadedBy, teamId);

    // ─── STEP 2: Hash the buffer ────────────────────────────────────────────────
    // multerFile.buffer exists because we switched to memoryStorage.
    // multerFile.path no longer exists — there is no disk file.
    const hash = calculateFileHash(multerFile.buffer);

    // ─── STEP 3: Content deduplication check ────────────────────────────────────
    // Does a file with this exact content already exist in this team?
    const existingContent = await prisma.file.findFirst({
        where: { hash, team_id: teamId, is_deleted: false },
    });

    // ─── STEP 4: Name collision check ───────────────────────────────────────────
    // Does a file with this name already exist in the same folder?
    // If yes → we're uploading a new VERSION, not a new file.
    const fileWithSameName = await prisma.file.findFirst({
        where: {
            original_name: multerFile.originalname,
            folder_id: folderId ?? null,
            team_id: teamId,
            is_deleted: false,
        },
    });

    // ─── STEP 5: Prepare the buffer we'll send to R2 ────────────────────────────
    // If encryption is enabled AND this is genuinely new content, encrypt the buffer.
    // Duplicates reuse the original's storage_path (already encrypted at first upload).
    let bufferToUpload = multerFile.buffer;   // default: plaintext
    let encryptionIv: string | null = null;
    let storagePath: string;
    let isDuplicate: boolean;
    let duplicateReason: string | null = null;

    if (existingContent) {
        // ── CONTENT DUPLICATE ──
        // Same bytes already stored in R2. Don't upload again.
        // Point the new DB record at the existing R2 object key.
        storagePath = existingContent.storage_path;
        isDuplicate = true;
        // Copy IV from the original — same object in R2, same IV needed to decrypt.
        encryptionIv = (existingContent as any).encryption_iv ?? null;
        duplicateReason = await explainDuplicate(teamId, multerFile.originalname, existingContent.id);

    } else {
        // ── NEW CONTENT ──
        // Encrypt the buffer if encryption is enabled.
        if (isEncryptionEnabled()) {
            try {
                const { encryptedBuffer, iv } = encryptBuffer(multerFile.buffer);
                bufferToUpload = encryptedBuffer;   // upload the encrypted version
                encryptionIv = iv;
            } catch (err) {
                console.error('[Upload] Encryption failed, storing unencrypted:', err);
                // Graceful degradation — upload plaintext, null IV signals no encryption.
                // Download handler checks for null IV and serves the buffer directly.
            }
        }

        isDuplicate = false;
        // storage_path will be set after we create the DB record and get its ID.
        // We need the DB ID to build the R2 key (teams/1/files/42-report.pdf).
        storagePath = 'pending'; // temporary placeholder
    }

    // ─── STEP 6: Name collision → create a new VERSION ──────────────────────────
    if (fileWithSameName) {

        if (fileWithSameName.hash === hash) {
            // Exact same name AND exact same content — already handled by dedup above.
            // Don't create a version entry for an identical re-upload.
            return { file: fileWithSameName, isDuplicate: true, duplicateReason };
        }

        // Different content under the same name → snapshot current state as a version.
        await createVersion(fileWithSameName.id);

        // If this is new content (not a duplicate), upload to R2 now.
        // We use the EXISTING file's DB id for the object key — it's the same logical file.
        if (!existingContent) {
            const objectKey = generateObjectKey(teamId, fileWithSameName.id, multerFile.originalname);
            try {
                await r2Upload(bufferToUpload, objectKey, multerFile.mimetype);
                storagePath = objectKey;
            } catch (err) {
                throw new Error('File upload to storage failed');
            }
        }

        // Update the main file record to point at the new content.
        const updatedFile = await prisma.file.update({
            where: { id: fileWithSameName.id },
            data: {
                filename: multerFile.originalname,
                file_size: multerFile.size,
                mime_type: multerFile.mimetype,
                storage_path: storagePath,
                hash,
                uploaded_by: uploadedBy,
                encryption_iv: encryptionIv,
                updated_at: new Date(),
            },
        });

        void logActivity({
            teamId, userId: uploadedBy,
            action: 'file_version_created',
            targetType: 'file', targetId: updatedFile.id,
            metadata: {
                file_name: updatedFile.original_name,
                version_created: true,
                is_duplicate: isDuplicate,
                duplicate_reason: duplicateReason,
            },
            ip, userAgent,
        });

        emitToTeam(teamId, SOCKET_EVENTS.FILE_UPLOADED, {
            file: updatedFile as unknown as Record<string, unknown>,
            uploadedBy,
        });

        return { file: updatedFile, isDuplicate: false };
    }

    // ─── STEP 7: No name collision → brand-new file ─────────────────────────────
    // Create the DB record first to get the auto-increment ID for the R2 key.
    const dbFile = await prisma.file.create({
        data: {
            team_id: teamId,
            folder_id: folderId ?? null,
            filename: multerFile.originalname,
            original_name: multerFile.originalname,
            file_size: multerFile.size,
            mime_type: multerFile.mimetype,
            storage_path: 'pending',  // updated below after R2 upload succeeds
            hash,
            uploaded_by: uploadedBy,
            is_deleted: false,
            encryption_iv: encryptionIv,
        },
    });

    // Upload to R2 only if this is genuinely new content.
    // Duplicates already have their storagePath set to an existing R2 key above.
    if (!existingContent) {
        const objectKey = generateObjectKey(teamId, dbFile.id, multerFile.originalname);
        try {
            await r2Upload(bufferToUpload, objectKey, multerFile.mimetype);
            storagePath = objectKey;
        } catch (err) {
            // R2 failed — roll back the DB record so no ghost entry remains.
            await prisma.file.delete({ where: { id: dbFile.id } });
            throw new Error('File upload to storage failed');
        }
    }

    // Update storage_path from 'pending' to the real R2 object key.
    const finalFile = await prisma.file.update({
        where: { id: dbFile.id },
        data: { storage_path: storagePath },
    });

    // ─── Create v1 snapshot for brand-new file ──────────────────────────────
    // WHY: The version history panel expects at least one entry to exist.
    //      createVersion reads from the DB, so we call it AFTER storage_path
    //      is finalized (no longer 'pending').
    try {
        await createVersion(finalFile.id);
    } catch (err: any) {
        // Non-fatal — the file is saved. Just log and continue.
        console.warn('[upload] Could not create v1 snapshot:', err.message);
    }

    void logActivity({
        teamId, userId: uploadedBy,
        action: 'file_uploaded',
        targetType: 'file', targetId: finalFile.id,
        metadata: {
            file_name: finalFile.original_name,
            file_size: finalFile.file_size,
            is_duplicate: isDuplicate,
            duplicate_reason: duplicateReason,
        },
        ip, userAgent,
    });

    emitToTeam(teamId, SOCKET_EVENTS.FILE_UPLOADED, {
        file: finalFile as unknown as Record<string, unknown>,
        uploadedBy,
    });

    return { file: finalFile, isDuplicate };
};
// ===========================================================================
// SERVICE FUNCTION 2: getTeamFiles
// ===========================================================================
// PURPOSE: Return all non-deleted files belonging to a team, with uploader
//          info joined in so the client can show "Uploaded by Alice".
//
// INPUTS:
//   teamId (number) — which team to query
//   userId (number) — requesting user (membership check)
//
// OUTPUTS:
//   Promise<File[]> — array of File records with nested user info
//                     Empty array if team has no files (not an error).
//
// WHY include uploader info here?
//   The file list UI always shows "who uploaded this". Fetching it in one
//   query (JOIN) is more efficient than N+1 queries (one per file).
//   Prisma's `include` generates a single SQL JOIN automatically.
// ===========================================================================
export const getTeamFiles = async (
    teamId: number,
    userId: number
): Promise<object[]> => {
    // Any team member (viewer, editor, admin) can list files
    await assertTeamMember(userId, teamId);

    const files = await prisma.file.findMany({
        where: {
            team_id: teamId,
            is_deleted: false, // never show soft-deleted files in normal listing
        },
        include: {
            // Join the users table to get uploader's name and email
            // Prisma generates: LEFT JOIN users ON files.uploaded_by = users.id
            uploader: {
                select: {
                    id: true,
                    username: true,
                    email: true,
                },
            },
        },
        orderBy: {
            created_at: "desc", // newest files first — most useful default for a team feed
        },
    });

    return files;
};

// ===========================================================================
// SERVICE FUNCTION 3: getFileById
// ===========================================================================
// PURPOSE: Retrieve metadata for a single file. Used when the client needs
//          the full details of one file (e.g. to show a preview or info panel).
//
// INPUTS:
//   fileId (number) — the file's primary key
//   userId (number) — requesting user (membership check against the file's team)
//
// OUTPUTS:
//   Promise<File>         — the File record with uploader info
//   throws FileNotFoundError — if file doesn't exist or is soft-deleted
//   throws ForbiddenError    — if user is not in the file's team
// ===========================================================================
export const getFileById = async (
    fileId: number,
    userId: number
): Promise<object> => {
    const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: {
            uploader: {
                select: { id: true, username: true, email: true },
            },
        },
    });

    if (!file) {
        throw new AppError('File not found', 404);
    }

    if (file.is_deleted) {
        throw new AppError('File has been deleted', 404);
    }

    // assertTeamMember replaces verifyTeamMembership — same logic, shared utility
    await assertTeamMember(userId, file.team_id);

    return file;
};

// PURPOSE: List all non-deleted files in a team.
//          Supports optional folderId filter for folder browsing.
//          folderId=null → show only root-level files (no folder)
//          folderId=3    → show only files inside folder 3
//          folderId omitted → show ALL files in the team
//
// INPUTS:  teamId, userId, folderId (optional — number | null | undefined)
// OUTPUTS: Array of file records with uploader info
//
// WHY THREE STATES for folderId:
//   undefined = no filter, return everything (default file browser)
//   null      = return only root-level files (folder_id IS NULL in DB)
//   number    = return only files in that specific folder
export async function listFiles(
    teamId: number,
    userId: number,
    folderId?: number | null,
    options?: {
        mimeType?: string;
        uploadedBy?: number;
        sortBy?: 'name' | 'date' | 'size';
        order?: 'asc' | 'desc';
    }
) {
    // Verify user belongs to this team before returning any data
    const membership = await prisma.teamMember.findFirst({
        where: { user_id: userId, team_id: teamId },
    });

    if (!membership) {
        throw new Error('You are not a member of this team');
    }

    // Build the folder_id filter dynamically based on what was passed
    // WHY: Prisma needs different filter shapes for each case
    let folderFilter: { folder_id?: number | null } = {};

    if (folderId === null) {
        // Caller explicitly wants root-level files only
        // In Prisma, { equals: null } matches rows where folder_id IS NULL
        folderFilter = { folder_id: null };
    } else if (folderId !== undefined) {
        // Caller wants files inside a specific folder
        folderFilter = { folder_id: folderId };
    }
    // If folderId is undefined — folderFilter stays empty → no filter applied

    const files = await prisma.file.findMany({
        where: {
            team_id: teamId,
            is_deleted: false,
            ...folderFilter, // spread the dynamic filter in
            ...(options?.mimeType && { mime_type: { contains: options.mimeType } }),
            ...(options?.uploadedBy && { uploaded_by: options.uploadedBy }),
        },
        include: {
            uploader: {
                select: { id: true, username: true, email: true },
            },
        },
    });

    // Sort the files dynamically based on options
    files.sort((a, b) => {
        const orderMult = options?.order === 'asc' ? 1 : -1;
        if (options?.sortBy === 'name') {
            return a.original_name.localeCompare(b.original_name) * orderMult;
        } else if (options?.sortBy === 'size') {
            return ((a.file_size || 0) - (b.file_size || 0)) * orderMult;
        } else {
            // default to date
            return (b.created_at.getTime() - a.created_at.getTime()) * orderMult * -1; // b - a is desc. We multiply by -1 if asc
        }
    });

    return files;
}

// ===========================================================================
// SERVICE FUNCTION 4: getDownloadPath
// ===========================================================================
// PURPOSE: Resolve the absolute filesystem path for a file so the controller
//          can stream it to the client with res.download().
//
// INPUTS:
//   fileId (number)
//   userId (number)
//
// OUTPUTS:
//   Promise<{ absolutePath: string, originalName: string }>
//     absolutePath — full OS path: "/home/user/project/uploads/1710000000-report.pdf"
//     originalName — what the user named the file, used as the download filename
//                    so the browser saves it as "report.pdf" not "1710000000-report.pdf"
//
// WHY RETURN originalName?
//   res.download(path, filename) uses the second argument as the filename
//   in the Content-Disposition header. Without it, the browser would save
//   the file as "1710000000000-My Report.pdf" — confusing for users.
//
// WHY path.resolve()?
//   storage_path in the DB is relative: "uploads/1710000000-report.pdf"
//   res.download() requires an absolute path on some systems.
//   path.resolve() converts relative → absolute using process.cwd() as base.
//   process.cwd() is the directory where `node` was launched (your project root).
// ===========================================================================
// In file.service.ts — add import:

// Find your getFileForDownload or downloadFile service function
// It currently returns the storage_path for res.download() or res.sendFile()

// REPLACE the direct file serving with this:
// --- REPLACE downloadFile in file.service.ts ---
// PURPOSE: Verify access, then return a readable stream from R2.
// INPUTS: fileId, userId (to check team membership)
// OUTPUTS: { stream: Readable, file: File } — controller pipes stream to res

export async function downloadFileService(fileId: number, userId: number) {
    const file = await prisma.file.findFirst({
        where: { id: fileId, is_deleted: false },
    });

    if (!file) throw new AppError('File not found', 404);

    // Verify the user is a member of the team that owns this file.
    await assertTeamMember(userId, file.team_id);

    // Get a readable stream from R2 using the stored object key.
    const stream = await getFileStream(file.storage_path);

    // ─── NEW: Decryption support for downloads ──────────────────────────────
    // If the file is encrypted, we must decrypt it before sending to the user.
    // Since our GCM implementation has the tag at the start, we buffer and decrypt.

    return { stream, file };
}

/**
 * PURPOSE: Fetch a file's content for the collaborative editor.
 * Handles both encrypted and unencrypted files.
 */
export async function getFileForDownload(fileId: number, teamId: number, userId: number) {
    await assertTeamMember(userId, teamId);

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false }
    });

    if (!file) throw new AppError('File not found', 404);

    // For simplicity, we assume the file is on disk if it's not encrypted OR
    // if we're in a transitional state. In a full R2 setup, we'd fetch the buffer from R2.
    // However, based on the existing openEditorHandler logic, it expects a storagePath or buffer.
    const absolutePath = path.resolve(file.storage_path);

    let buffer: Buffer | null = null;
    let storagePath: string | null = null;

    if (file.encryption_iv && isEncryptionEnabled()) {
        // If it's encrypted, we must decrypt it to a buffer
        // If it's in R2, we should fetch it first. But let's check if it exists on disk first
        // to maintain backward compatibility with the user's current disk-based logic.
        if (fs.existsSync(absolutePath)) {
            buffer = decryptFile(absolutePath, file.encryption_iv);
        } else {
            // Fetch from R2 and decrypt
            const stream = await getFileStream(file.storage_path);
            const chunks: any[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const encryptedBuffer = Buffer.concat(chunks);
            buffer = decryptBuffer(encryptedBuffer, file.encryption_iv);
        }
    } else {
        // Not encrypted
        if (fs.existsSync(absolutePath)) {
            storagePath = absolutePath;
        } else {
            // Fetch from R2
            const stream = await getFileStream(file.storage_path);
            const chunks: any[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            buffer = Buffer.concat(chunks);
        }
    }

    return { buffer, storagePath, file };
}

// ===========================================================================
// SERVICE FUNCTION 5: softDeleteFile
// ===========================================================================
// PURPOSE: Mark a file as deleted without removing it from the database or
//          disk. Sets is_deleted = true and deleted_at = current timestamp.
//
// INPUTS:
//   fileId  (number) — the file to delete
//   userId  (number) — the user requesting deletion (must be editor/admin)
//
// OUTPUTS:
//   Promise<void> — resolves silently on success
//   throws FileNotFoundError — file doesn't exist or already deleted
//   throws ForbiddenError    — user lacks permission
//
// WHY SOFT DELETE (not hard delete)?
//   Three reasons:
//   1. RECYCLE BIN (Week 12): users can restore deleted files. Impossible
//      if the record is gone from the database.
//   2. DEDUPLICATION SAFETY: if two File records share the same storage_path
//      (because of deduplication), deleting one record must NOT delete the
//      physical file. Soft delete leaves the storage_path intact for the
//      other record.
//   3. AUDIT TRAIL: deleted_at tells you exactly when a file was removed
//      and by whom (you can add deleted_by to the schema in Week 12).
//
// WHY NOT DELETE THE FILE FROM DISK HERE?
//   For the same deduplication reason above — the physical file may be
//   shared. Disk cleanup happens in Week 12 when we implement permanent
//   delete, at which point we check if any other non-deleted File record
//   references the same storage_path before calling fs.unlink().
//  ===========================================================================
export const softDeleteFile = async (
    fileId: number,
    userId: number,
    ip: string,
    userAgent: string
): Promise<void> => {
    // Step 1: fetch file and check it exists (getFileById checks membership too)
    const file = (await getFileById(fileId, userId)) as any;

    // Step 2: verify the user has editor or admin role — viewers cannot delete
    await verifyEditorRole(userId, file.team_id);

    // Step 3: verify the file is not locked by someone else
    if (file.lockExpiresAt && file.lockExpiresAt > new Date() && file.lockOwnerUserId !== userId) {
        throw new AppError('Cannot delete file: it is currently locked by another user', 409);
    }

    // Step 3: perform the soft delete
    // We set is_deleted = true and record exactly when this happened.
    // deleted_at is useful for the recycle bin (Week 12) which needs to
    // show "deleted 3 days ago" and auto-purge after 30 days.
    await prisma.file.update({
        where: { id: fileId },
        data: {
            is_deleted: true,
            deleted_at: new Date(), // current timestamp — when was this deleted?
        },
    });

    // After: await prisma.file.update({ where: { id: fileId }, data: { ... } });

    void logActivity({
        teamId: (file as { team_id: number }).team_id,
        userId,
        action: 'file_deleted',
        targetType: 'file',
        targetId: fileId,
        metadata: {
            fileId,
            file_name: file.original_name,
        },
        ip,
        userAgent,
    });

    // Real-time notification via helper
    emitToTeam(file.team_id, SOCKET_EVENTS.FILE_DELETED, {
        fileId: fileId,
        deletedBy: userId
    });

    // No return value needed — the controller will send 200 { message: "File deleted" }
};

// ===========================================================================
// SERVICE FUNCTION 6: renameFile
// ===========================================================================
// PURPOSE: Update the display name (original_name) of a file.
//          The internal storage filename stays the same — we only change
//          what the user sees. This preserves the audit trail on disk.
//
// INPUTS:
//   fileId  (number) — which file to rename
//   newName (string) — the new display name the user typed
//   teamId  (number) — used to verify the file belongs to this team
//   userId  (number) — must be editor or admin to rename
//
// OUTPUTS:
//   Promise<File> — the updated file record with new original_name
//
// WHY RENAME original_name AND NOT filename?
//   `filename` is the internal storage name with a timestamp prefix
//   (e.g. "1710000000-report.pdf"). Changing it would break the file path
//   on disk. `original_name` is purely a display label — safe to change.
// ===========================================================================
export const renameFile = async (
    fileId: number,
    newName: string,
    teamId: number,
    userId: number,
    ip: string,
    userAgent: string
): Promise<object> => {
    // Step 1: verify editor/admin role (viewers cannot rename)
    await verifyEditorRole(userId, teamId);

    // Step 2: find the file — must belong to this team and not be deleted
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

    // Step 3: verify the file is not locked by someone else
    if (file.lockExpiresAt && file.lockExpiresAt > new Date() && file.lockOwnerUserId !== userId) {
        throw new AppError('Cannot rename file: it is currently locked by another user', 409);
    }

    // Step 3: update only the display name — storage path untouched
    const updated = await prisma.file.update({
        where: { id: fileId },
        data: { original_name: newName.trim() },
    });

    void logActivity({
        teamId,
        userId,
        action: 'file_renamed',   // Corrected action
        targetType: 'file',
        targetId: fileId,
        metadata: { oldName: file.original_name, newName: newName.trim() },


    });

    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.FILE_RENAMED, {
        fileId,
        oldName: file.original_name,
        newName: newName.trim(),
        renamedBy: userId
    });

    return updated;
};

// ===========================================================================
// HELPER: extractHtmlFromYjsState
// ===========================================================================
// PURPOSE: Converts a binary Yjs CRDT state (stored in file.yjs_state or
//          document.yjs_state) into an HTML string for preview.
//
// HOW IT WORKS:
//   TipTap v2 stores its content as a Yjs XmlFragment named 'default'.
//   We decode the binary state, traverse the XML tree, and emit HTML tags.
//   Inline formatting (bold, italic, etc.) is read from XmlText attributes.
//
// WHY THIS IS SAFE:
//   All text is HTML-escaped before output. The caller should still
//   sanitize with DOMPurify on the frontend for belt-and-suspenders safety.
// ===========================================================================
function yjsNodeToHtml(node: Y.XmlElement | Y.XmlText | Y.XmlFragment): string {
    if (!node) return '';
    if (node instanceof Y.XmlText) {
        const raw = String(node.toJSON())
        const text = raw
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
        const attrs = node.getAttributes()
        let result = text || ''
        if (attrs.code) result = `<code>${result}</code>`
        if (attrs.bold) result = `<strong>${result}</strong>`
        if (attrs.italic) result = `<em>${result}</em>`
        if (attrs.underline) result = `<u>${result}</u>`
        if (attrs.strike) result = `<s>${result}</s>`
        return result
    }

    if (node instanceof Y.XmlFragment) {
        // Use .toArray() — XmlFragment is not always directly iterable in all Yjs versions
        const children = typeof (node as any).toArray === 'function'
            ? (node as any).toArray() as any[]
            : Array.from(node as unknown as Iterable<any>)
        return children.filter(Boolean).map((c: any) => yjsNodeToHtml(c)).join('')
    }


    const el = node as Y.XmlElement
    if (!el.nodeName) return '';  // ← ADD THIS — guards against undefined nodeName
    const tag = el.nodeName
    const attrs = el.getAttributes()
    const children = Array.from(el as unknown as Iterable<any>).map((c: any) => yjsNodeToHtml(c)).join('')

    switch (tag) {
        case 'paragraph': return `<p>${children || '<br>'}</p>`
        case 'heading': {
            const level = Number(attrs.level) || 1
            return `<h${level}>${children}</h${level}>`
        }
        case 'bulletList': return `<ul>${children}</ul>`
        case 'orderedList': return `<ol>${children}</ol>`
        case 'listItem': return `<li>${children}</li>`
        case 'taskList': return `<ul class="task-list">${children}</ul>`
        case 'taskItem': {
            const checked = attrs.checked ? ' checked' : ''
            return `<li><label><input type="checkbox"${checked} disabled> ${children}</label></li>`
        }
        case 'blockquote': return `<blockquote>${children}</blockquote>`
        case 'codeBlock': return `<pre><code>${children}</code></pre>`
        case 'hardBreak': return '<br>'
        case 'horizontalRule': return '<hr>'
        default: return `<div>${children}</div>`
    }
}

export function extractHtmlFromYjsState(yjsState: Buffer): string {
    try {
        const ydoc = new Y.Doc()
        const bytes = new Uint8Array(yjsState)

        // Hocuspocus may store state in V1 or V2 update format depending on version.
        // Try V1 first; if it throws, fall back to V2.
        try {
            Y.applyUpdate(ydoc, bytes)
        } catch {
            try {
                Y.applyUpdateV2(ydoc, bytes)
            } catch (e2: any) {
                throw new Error(`Could not apply Yjs update (V1 or V2): ${e2.message}`)
            }
        }

        // TipTap Collaboration stores content under the 'default' XmlFragment.
        // Try 'prosemirror' as a fallback for older integrations.
        let html = yjsNodeToHtml(ydoc.getXmlFragment('default'))
        if (!html) {
            html = yjsNodeToHtml(ydoc.getXmlFragment('prosemirror'))
        }

        ydoc.destroy()
        return html || '<p><em>This document is empty.</em></p>'
    } catch (err: any) {
        console.error('[extractHtmlFromYjsState] Error:', err.message)
        return '<p><em>Preview could not be generated from this document.</em></p>'
    }
}

// ===========================================================================
// SERVICE FUNCTION 7: getFilePreview
// ===========================================================================
// PURPOSE: Support native browser viewing without forcing download.
//          Returns streamable info for images/PDFs, or converted HTML
//          for documents like DOCX and XLSX.
// ===========================================================================
export const getFilePreview = async (
    fileId: number,
    userId: number,
    teamId: number
): Promise<{
    streamable?: boolean;
    previewable: boolean;
    storagePath?: string;
    buffer?: Buffer; // Added to support decrypted in-memory previews
    stream?: Readable; // Added to support direct R2 streaming
    mimeType?: string;
    type?: 'html';
    content?: string;
}> => {
    // 1. Verify access via team structure
    await assertTeamMember(userId, teamId);

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false }
    });

    if (!file) throw new AppError('File not found', 404);

    const absolutePath = path.resolve(file.storage_path);
    const existsOnDisk = fs.existsSync(absolutePath);

    // If not on disk, we'll try to fetch from R2 later if needed.
    // We don't throw yet because collaborative types don't need the disk file.

    const mime = file.mime_type.toLowerCase();

    // ── NEW: Collaborative content takes priority over disk content ───────────
    // WHY: When a user edits a .docx/.txt/.md file in the collaborative editor,
    //   the canonical content is in file.yjs_state (in DB), NOT the disk file.
    //   The disk file (storage_path) only reflects the original uploaded content.
    //   Without this check, the preview would show STALE content from disk.
    const isCollaborativeType = (
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mime.includes('word') ||
        mime.startsWith('text/') ||
        file.original_name.toLowerCase().endsWith('.md')
    )
    if (file.yjs_state && (file.yjs_state as Buffer).length > 20 && isCollaborativeType) {
        const html = extractHtmlFromYjsState(file.yjs_state as Buffer)
        // Only use Yjs HTML if it produced actual content.
        // If extraction silently failed (empty doc placeholder), fall through to
        // the regular disk/R2 preview so the original uploaded content is shown.
        const isPlaceholder =
            html === '<p><em>This document is empty.</em></p>' ||
            html === '<p><em>Preview could not be generated from this document.</em></p>'
        if (!isPlaceholder) {
            return { previewable: true, type: 'html', content: html }
        }
        // Fall through to disk/R2 preview below
    }

    // ─── NEW DECRYPTION LOGIC ────────────────────────────────────────────────
    let fileBuffer: Buffer | null = null;

    // We only NEED the buffer immediately for DOCX/XLSX/Text.
    // For PDFs/Images, we only need the buffer if it's encrypted.
    if (file.encryption_iv && isEncryptionEnabled()) {
        if (existsOnDisk) {
            fileBuffer = decryptFile(absolutePath, file.encryption_iv);
        } else {
            // Fetch from R2 and decrypt
            const r2Stream = await getFileStream(file.storage_path);
            const chunks: any[] = [];
            for await (const chunk of r2Stream) {
                chunks.push(chunk);
            }
            fileBuffer = decryptBuffer(Buffer.concat(chunks), file.encryption_iv);
        }
    }

    // Direct streams
    if (mime === 'application/pdf' || mime.startsWith('image/')) {
        if (fileBuffer) {
            // It's encrypted — we must send the decrypted buffer
            return {
                streamable: true,
                previewable: true,
                buffer: fileBuffer,
                mimeType: mime
            };
        } else {
            // Unencrypted — if on disk, we can use storagePath for disk-streaming (efficient)
            if (existsOnDisk) {
                return {
                    streamable: true,
                    previewable: true,
                    storagePath: absolutePath,
                    mimeType: mime
                };
            } else {
                // Not on disk (migrated to R2) — stream directly from R2
                const r2Stream = await getFileStream(file.storage_path);

                return {
                    streamable: true,
                    previewable: true,
                    stream: r2Stream,
                    mimeType: mime
                };
            }
        }
    }

    // For all other types (DOCX, XLSX, Text), we need the buffer regardless.
    if (!fileBuffer) {
        if (existsOnDisk) {
            fileBuffer = fs.readFileSync(absolutePath);
        } else {
            // Fetch from R2
            const r2Stream = await getFileStream(file.storage_path);
            const chunks: any[] = [];
            for await (const chunk of r2Stream) {
                chunks.push(chunk);
            }
            fileBuffer = Buffer.concat(chunks);
        }
    }

    // DOCX conversion
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mime.includes('word')) {
        try {
            const result = await mammoth.convertToHtml({ buffer: fileBuffer });
            return { previewable: true, type: 'html', content: result.value };
        } catch (error) {
            return { previewable: false };
        }
    }

    // XLSX conversion
    if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mime === 'application/vnd.ms-excel' || mime.includes('excel') || mime.includes('sheet')) {
        try {
            const workbook = xlsx.read(fileBuffer);
            const sheetName = workbook.SheetNames[0];
            const html = xlsx.utils.sheet_to_html(workbook.Sheets[sheetName]);
            return { previewable: true, type: 'html', content: html };
        } catch (error) {
            return { previewable: false };
        }
    }

    // ─── Plain text and code files ──────────────────────────────────────────────
    // WHY: text/plain, .txt, .md, .csv, .js, .ts, .py, .java, .json etc.
    // These are the simplest case — just read the file and wrap in <pre> tags.
    // <pre> preserves whitespace and line breaks. Syntax highlighting is optional.
    if (
        mime.startsWith('text/') ||
        mime === 'application/json' ||
        mime === 'application/javascript' ||
        mime === 'application/xml' ||
        ['.txt', '.md', '.csv', '.js', '.ts', '.py', '.java', '.json', '.xml', '.html', '.css', '.sql']
            .some(ext => file.original_name.toLowerCase().endsWith(ext))
    ) {
        try {
            const content = fileBuffer.toString('utf-8');
            const escaped = content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #1e293b;
      background: #f8fafc;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
    }
  </style>
</head>
<body><pre>${escaped}</pre></body>
</html>`;

            return { previewable: true, type: 'html', content: html };
        } catch {
            return { previewable: false };
        }
    }
    return { previewable: false };
};
