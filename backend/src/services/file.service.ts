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
import prisma from "../config/database"; // Prisma singleton
import { calculateFileHash } from "../utils/hash"; // SHA-256 utility
import { UPLOADS_DIR } from "../config/multer"; // single source of truth for upload dir
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity, ActivityAction, ActivityTargetType } from '../utils/activityLogger';
import { explainDuplicate } from './AI/duplicateExplain.service';
import { File as PrismaFile } from '../generated/prisma';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';
import { createVersion } from './version.service';
import { encryptFile, isEncryptionEnabled, decryptFile } from '../utils/fileEncryption'
import * as Y from 'yjs'

// ---------------------------------------------------------------------------
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
// HELPER: verifyTeamMembership
// ---------------------------------------------------------------------------
// PURPOSE: Confirm that a user belongs to a specific team before allowing
//          any file operation. This is the authorisation gate for every
//          function in this service.
//
// INPUTS:
//   userId (number) — the ID of the requesting user (from JWT payload)
//   teamId (number) — the team the operation targets
//
// OUTPUTS:
//   Promise<void>   — resolves silently if member found
//                   — throws ForbiddenError if not a member
//
// WHY A SEPARATE HELPER?
//   Every service function needs this check. Extracting it avoids
//   duplicating the same Prisma query 5 times. If the check logic ever
//   changes (e.g. add suspended-member status), we update one place.
// ---------------------------------------------------------------------------


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
    // STEP 1: Verify the uploader has editor or admin role in this team
    await verifyEditorRole(uploadedBy, teamId);

    // STEP 3: Check for an existing file with the same NAME in the same FOLDER
    // WHY? If 'report.pdf' already exists, we should create a new version of it,
    // NOT a separate file record. This satisfies the "Versioning" requirement.
    const fileWithSameName = await prisma.file.findFirst({
        where: {
            original_name: multerFile.originalname,
            folder_id: folderId ?? null,
            team_id: teamId,
            is_deleted: false,
        },
    });

    // STEP 4: Calculate SHA-256 hash of the uploaded file
    const hash = await calculateFileHash(multerFile.path);

    // STEP 5: Check for an existing file with this HASH (Content Deduplication)
    // We do this FIRST to ensure versions can also be deduplicated!
    const existingContent = await prisma.file.findFirst({
        where: {
            hash,
            team_id: teamId,
            is_deleted: false,
        },
    });

    let storagePath: string;
    let isDuplicate: boolean;
    let duplicateReason: string | null = null;

    if (existingContent) {
        // Content duplicate -> delete redundant disk copy
        if (fs.existsSync(multerFile.path)) {
            fs.unlinkSync(multerFile.path);
        }
        storagePath = existingContent.storage_path;
        isDuplicate = true;
        // Generate AI explanation for the duplicate
        duplicateReason = await explainDuplicate(teamId, multerFile.originalname, existingContent.id);
    } else {
        storagePath = multerFile.path;
        isDuplicate = false;
    }

    // STEP 5.5: Encryption (Week 15)
    // We only encrypt truly new files. Duplicates share the original's storage path
    // and were already encrypted (or not) when first uploaded.
    let encryptionIv: string | null = null;
    if (isEncryptionEnabled()) {
        if (isDuplicate && existingContent) {
            // Duplicate content -> copy the IV from the original file
            // Since they share the storage path, they MUST share the same IV.
            encryptionIv = (existingContent as any).encryption_iv;
        } else if (!isDuplicate) {
            // Truly new file -> encrypt it
            try {
                const result = await encryptFile(multerFile.path);
                encryptionIv = result.iv;
                console.log(`[Upload] File encrypted, IV generated: ${encryptionIv}`);
            } catch (err) {
                console.error('[Upload] Encryption failed:', err);
                // Don't fail the upload — store unencrypted with null IV
                // The download handler checks for null IV and serves file directly
            }
        }
    }

    if (fileWithSameName) {
        // NAME CLASH -> POTENTIAL NEW VERSION

        if (fileWithSameName.hash === hash) {
            // EXACT SAME FILE UPLOADED AGAIN (Same Name AND Same Content)
            // It's already deduplicated above (fs.unlinkSync ran).
            // Do NOT create a version. Just return the existing file to avoid spamming versions.
            return { file: fileWithSameName, isDuplicate: true, duplicateReason };
        }

        // DIFFERENT CONTENT -> CREATE A NEW VERSION
        // 1. Snapshot the CURRENT state of the file into FileVersion table
        await createVersion(fileWithSameName.id);

        // 2. Update the main File record with the NEW upload data
        const updatedFile = await prisma.file.update({
            where: { id: fileWithSameName.id },
            data: {
                filename: multerFile.filename,
                file_size: multerFile.size,
                mime_type: multerFile.mimetype,
                storage_path: storagePath, // Use the deduplicated or new path!
                hash: hash,
                uploaded_by: uploadedBy,
                updated_at: new Date(),
            },
        });

        void logActivity({
            teamId,
            userId: uploadedBy,
            action: 'file_version_created', // Specific action for versioning
            targetType: 'file',
            targetId: updatedFile.id,
            metadata: {
                file_name: updatedFile.original_name,
                version_created: true,
                is_duplicate: isDuplicate,
                duplicate_reason: duplicateReason
            },
            ip,
            userAgent,
        });

        // Real-time notification via helper
        emitToTeam(teamId, SOCKET_EVENTS.FILE_UPLOADED, {
            file: updatedFile as unknown as Record<string, unknown>,
            uploadedBy: uploadedBy
        });

        return { file: updatedFile, isDuplicate: false };
    }

    // STEP 6: NO NAME CLASH -> Create a brand-new File record
    const file = await prisma.file.create({
        data: {
            team_id: teamId,
            folder_id: folderId ?? null,
            filename: multerFile.filename,
            original_name: multerFile.originalname,
            file_size: multerFile.size,
            mime_type: multerFile.mimetype,
            storage_path: storagePath,
            hash,
            uploaded_by: uploadedBy,
            is_deleted: false,
            encryption_iv: encryptionIv, // ← ADD THIS
        },
    });

    void logActivity({
        teamId,
        userId: uploadedBy,          // your function uses uploadedBy, not userId
        action: 'file_uploaded',
        targetType: 'file',
        targetId: file.id,
        metadata: {
            file_name: file.original_name,   // ← THIS is what the renderer looks for
            file_size: file.file_size,        // keep for reference but we'll hide it
            is_duplicate: isDuplicate,
            duplicate_reason: duplicateReason
        },
        ip,
        userAgent,
    });

    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.FILE_UPLOADED, {
        file: file as unknown as Record<string, unknown>,
        uploadedBy: uploadedBy
    });

    return { file, isDuplicate };
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
    folderId?: number | null  // undefined = no filter, null = root level
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
        },
        include: {
            uploader: {
                select: { id: true, username: true, email: true },
            },
        },
        orderBy: { created_at: 'desc' },
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
export async function getFileForDownload(
    fileId: number,
    teamId: number,
    userId: number
): Promise<{ buffer: Buffer | null; storagePath: string | null; file: PrismaFile }> {

    await assertTeamMember(userId, teamId)

    const file = await prisma.file.findFirst({
        where: { id: fileId, team_id: teamId, is_deleted: false }
    })
    if (!file) throw new AppError('File not found', 404)

    const absolutePath = path.resolve(file.storage_path)
    if (!fs.existsSync(absolutePath)) {
        throw new AppError('File not found on disk', 404)
    }

    // If file has an IV, it's encrypted — decrypt to buffer for streaming
    // If no IV, it's a legacy unencrypted file — serve directly
    // WHY RETURN BOTH: Controller uses buffer for encrypted, path for unencrypted
    if (file.encryption_iv && isEncryptionEnabled()) {
        const buffer = decryptFile(absolutePath, file.encryption_iv)
        return { buffer, storagePath: null, file }
    } else {
        return { buffer: null, storagePath: absolutePath, file }
    }
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
// ===========================================================================
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
    if (node instanceof Y.XmlText) {
        const raw = String(node.toJSON())
        const text = raw
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
        const attrs = node.getAttributes()
        let result = text || ''
        if (attrs.code)      result = `<code>${result}</code>`
        if (attrs.bold)      result = `<strong>${result}</strong>`
        if (attrs.italic)    result = `<em>${result}</em>`
        if (attrs.underline) result = `<u>${result}</u>`
        if (attrs.strike)    result = `<s>${result}</s>`
        return result
    }

    if (node instanceof Y.XmlFragment) {
        return Array.from(node as Iterable<any>).map((c: any) => yjsNodeToHtml(c)).join('')
    }

    const el = node as Y.XmlElement
    const tag = el.nodeName
    const attrs = el.getAttributes()
    const children = Array.from(el as Iterable<any>).map((c: any) => yjsNodeToHtml(c)).join('')

    switch (tag) {
        case 'paragraph':     return `<p>${children || '<br>'}</p>`
        case 'heading': {
            const level = Number(attrs.level) || 1
            return `<h${level}>${children}</h${level}>`
        }
        case 'bulletList':    return `<ul>${children}</ul>`
        case 'orderedList':   return `<ol>${children}</ol>`
        case 'listItem':      return `<li>${children}</li>`
        case 'taskList':      return `<ul class="task-list">${children}</ul>`
        case 'taskItem': {
            const checked = attrs.checked ? ' checked' : ''
            return `<li><label><input type="checkbox"${checked} disabled> ${children}</label></li>`
        }
        case 'blockquote':    return `<blockquote>${children}</blockquote>`
        case 'codeBlock':     return `<pre><code>${children}</code></pre>`
        case 'hardBreak':     return '<br>'
        case 'horizontalRule':return '<hr>'
        default:              return `<div>${children}</div>`
    }
}

export function extractHtmlFromYjsState(yjsState: Buffer): string {
    try {
        const ydoc = new Y.Doc()
        Y.applyUpdate(ydoc, new Uint8Array(yjsState))
        const xmlFragment = ydoc.getXmlFragment('default')
        const html = yjsNodeToHtml(xmlFragment)
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
    if (!fs.existsSync(absolutePath)) {
        throw new AppError('File missing from disk', 500);
    }

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
        return { previewable: true, type: 'html', content: html }
    }

    // ─── NEW DECRYPTION LOGIC ────────────────────────────────────────────────
    let fileBuffer: Buffer | null = null;

    // We only NEED the buffer immediately for DOCX/XLSX/Text.
    // For PDFs/Images, we only need the buffer if it's encrypted.
    if (file.encryption_iv && isEncryptionEnabled()) {
        fileBuffer = decryptFile(absolutePath, file.encryption_iv);
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
            // Unencrypted — stream directly from disk for better memory usage
            return {
                streamable: true,
                previewable: true,
                storagePath: absolutePath,
                mimeType: mime
            };
        }
    }

    // For all other types (DOCX, XLSX, Text), we need the buffer regardless.
    if (!fileBuffer) {
        fileBuffer = fs.readFileSync(absolutePath);
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