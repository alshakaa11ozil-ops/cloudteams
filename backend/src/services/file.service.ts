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
import path from "path";
import prisma from "../config/database"; // Prisma singleton
import { calculateFileHash } from "../utils/hash"; // SHA-256 utility
import { UPLOADS_DIR } from "../config/multer"; // single source of truth for upload dir
import { assertTeamMember, AppError } from '../utils/teamGuard';

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
    folderId?: number
): Promise<{ file: object; isDuplicate: boolean }> => {
    // STEP 1: Verify the uploader has editor or admin role in this team
    await verifyEditorRole(uploadedBy, teamId);

    // STEP 2: Calculate SHA-256 hash of the uploaded file
    // multerFile.path is the relative path multer saved the file to,
    // e.g. "uploads/1710000000000-report.pdf"
    const hash = await calculateFileHash(multerFile.path);

    // STEP 3: Check for an existing file with this hash in this team
    // WHY is_deleted: false?
    //   A deleted file's storage_path may be cleaned up eventually.
    //   We only deduplicate against LIVE files whose path is guaranteed valid.
    const existingFile = await prisma.file.findFirst({
        where: {
            hash,           // same content fingerprint
            team_id: teamId, // scoped to this team
            is_deleted: false, // only live files
        },
    });

    // STEP 4: Decide whether to keep the uploaded file or discard it
    let storagePath: string;
    let isDuplicate: boolean;

    if (existingFile) {
        // DUPLICATE DETECTED
        // The uploaded file is byte-for-byte identical to an existing team file.
        // We don't need the new copy — delete it from disk to save space.
        //
        // WHY fs.unlinkSync here (synchronous)?
        //   This is a cleanup step, not an I/O bottleneck. The file was just
        //   written moments ago and is small in the context of the full request.
        //   Synchronous keeps the code linear and easier to reason about.
        //   An async unlink could technically continue even if we return early.
        fs.unlinkSync(multerFile.path); // delete the redundant uploaded copy

        // The new DB record will point to the existing file's storage path
        storagePath = existingFile.storage_path;
        isDuplicate = true;
    } else {
        // NEW FILE — keep it on disk, use its path
        storagePath = multerFile.path; // e.g. "uploads/1710000000000-report.pdf"
        isDuplicate = false;
    }

    // STEP 5: Create a File record in the database
    // Even for duplicates, we create a NEW record. This is important because:
    //   - The new record has its own uploaded_by, created_at, folder_id
    //   - The user can delete their record without affecting others
    //   - The activity feed logs this user's upload separately
    const file = await prisma.file.create({
        data: {
            team_id: teamId,
            folder_id: folderId ?? null, // null means root level of the team
            filename: multerFile.filename,       // safe internal name with timestamp prefix
            original_name: multerFile.originalname, // what the user called it
            file_size: multerFile.size,          // bytes
            mime_type: multerFile.mimetype,      // e.g. "application/pdf"
            storage_path: storagePath,           // where the actual bytes live on disk
            hash,                                // SHA-256 fingerprint
            uploaded_by: uploadedBy,             // FK to users.id
            is_deleted: false,                   // not deleted on creation
        },
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
export const getDownloadPath = async (
    fileId: number,
    userId: number
): Promise<{ absolutePath: string; originalName: string }> => {
    // Reuse getFileById — it handles not-found and membership checks
    const file = (await getFileById(fileId, userId)) as {
        storage_path: string;
        original_name: string;
    };

    // Convert relative path → absolute path
    // Example: "uploads/1710000000-report.pdf"
    //       → "/home/user/project/uploads/1710000000-report.pdf"
    const absolutePath = path.resolve(file.storage_path);

    // Safety check: does the file actually exist on disk?
    // This can fail if the /uploads folder was manually cleared or the server
    // was moved without copying the uploads directory.
    if (!fs.existsSync(absolutePath)) {
        throw new FileNotFoundError(
            "File record exists but the file is missing from storage"
        );
    }

    return {
        absolutePath,
        originalName: file.original_name, // e.g. "Q3 Budget Report.xlsx"
    };
};

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
    userId: number
): Promise<void> => {
    // Step 1: fetch file and check it exists (getFileById checks membership too)
    const file = (await getFileById(fileId, userId)) as { team_id: number };

    // Step 2: verify the user has editor or admin role — viewers cannot delete
    await verifyEditorRole(userId, file.team_id);

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


    // No return value needed — the controller will send 200 { message: "File deleted" }
};