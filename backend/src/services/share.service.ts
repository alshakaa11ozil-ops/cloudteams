// src/services/share.service.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity } from '../utils/activityLogger';

// ---------------------------------------------------------------------------
// TYPES & INTERFACES
// ---------------------------------------------------------------------------
export interface CreateShareOptions {
    fileId?: number;          // Optional: If provided, shares ONE file. If omitted, shares ENTIRE TEAM.
    password?: string;        // Optional: Bcrypt hashed for security
    expiresInHours?: number;  // Optional: Used to calculate expiration datetime
    downloadLimit?: number;   // Optional: Maximum times the link can be used
}

// ===========================================================================
// SERVICE FUNCTION 1: createSharedLink
// ===========================================================================
// PURPOSE: Generates a secure, cryptographically random URL parameter (token)
//          that grants external access to either a single file or a full team.
//
// WHY THIS APPROACH: 
//   1. Cryptographic tokens (base64url) prevent IDOR (Insecure Direct Object
//      Reference) and enumeration attacks compared to sequential database IDs.
//   2. We check 'editor' or 'admin' explicitly. Viewers cannot share files.
//      This strict role boundary ensures data cannot be leaked by low-privileged members.
//   3. Hashing passwords via Bcrypt ensures that even if the database is
//      compromised, the attacker cannot read the literal password used for the share.
// ===========================================================================
export async function createSharedLink(
    userId: number,
    teamId: number,
    options: CreateShareOptions
) {
    // 1. Authorization: Only editors or admins can create share links. Viewers are blocked.
    await assertTeamMember(userId, teamId, 'editor');

    // 2. Validate file context if fileId is provided (Single File Share)
    if (options.fileId) {
        const file = await prisma.file.findFirst({
            where: { id: options.fileId, team_id: teamId }
        });
        // We ensure the file actually belongs to the team of the user acting on it.
        if (!file) throw new AppError('File not found in this team', 404);
        // Soft-deleted files cannot be shared out of the recycle bin.
        if (file.is_deleted) throw new AppError('Cannot share a deleted file', 400);
    }

    // 3. Generate a 32-character base64-url string via NodeJS built-in crypto.
    // Equivalent mathematically to hex but visually shorter and URL-safe.
    const token = crypto.randomBytes(24).toString('base64url');

    // 4. Secure the password via hashing if the user provided one.
    let password_hash: string | null = null;
    if (options.password) {
        password_hash = await bcrypt.hash(options.password, 10);
    }

    // 5. Dynamic Time-based Expiration.
    // If the user selects 6, 12, or 24 hours, we append that exact time dynamically
    // to the server's current timestamp (Date.now()).
    // ✅ NEW — null means permanent link (no expiry enforced)
    if (options.expiresInHours !== undefined && options.expiresInHours <= 0) {
        // Validate BEFORE computing — negative hours would create an already-expired link
        throw new AppError('expiresInHours must be a positive number', 400);
    }

    const expiration_date: Date | null = options.expiresInHours
        ? new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000)
        : null; // null

    // 6. Persist the link in PostgreSQL.
    const link = await prisma.sharedLink.create({
        data: {
            team_id: teamId,
            file_id: options.fileId ?? null,
            created_by: userId,
            token,
            password_hash,
            expiration_date,
            download_limit: options.downloadLimit ?? null
        }
    });

    // 7. Fire-and-forget Audit Trail Logging.
    void logActivity({
        teamId,
        userId,
        action: 'link_created',
        targetType: options.fileId ? 'file' : 'team',
        targetId: options.fileId ?? teamId,
        metadata: { linkId: link.id, hasPassword: !!password_hash }
    });

    return link;
}

// ===========================================================================
// SERVICE FUNCTION 2: getLinkMetadata
// ===========================================================================
// PURPOSE: Determine what *type* of link this is (Team Share or File Share) and
//          provide basic display info without leaking actual files.
//
// WHY THIS APPROACH:
//   This endpoint is completely unauthenticated (public). We rigorously validate
//   the `token` limits (expiration, hit count) BEFORE returning any filename
//   or team name. This prevents data scraping of expired links.
// ===========================================================================
export async function getLinkMetadata(token: string) {
    const link = await prisma.sharedLink.findUnique({
        where: { token },
        include: { file: true, team: true }
    });

    if (!link) throw new AppError('Link not found', 404);

    // Dynamic Expiration Check
    if (link.expiration_date && link.expiration_date < new Date()) {
        throw new AppError('This link has expired', 410);
    }

    // Capacity Check
    if (link.download_limit !== null && link.downloads_count >= link.download_limit) {
        throw new AppError('Maximum usage limit reached for this link', 410);
    }

    // Differentiate between File Share and Team Share
    if (link.file_id && link.file) {
        // Handle Edge Case: Deleted while link was still active
        if (link.file.is_deleted) throw new AppError('The shared file has been deleted by its owner', 404);

        return {
            type: 'file',
            id: link.id,
            filename: link.file.original_name,
            fileSize: link.file.file_size,
            mimeType: link.file.mime_type,
            requiresPassword: !!link.password_hash
        };
    } else {
        // Team Share Mode
        return {
            type: 'team',
            id: link.id,
            teamName: link.team.name,
            requiresPassword: !!link.password_hash
        };
    }
}

// ===========================================================================
// SERVICE FUNCTION 3: getTeamContent
// ===========================================================================
// PURPOSE: For Team Shares only. Allows guest to list files/folders.
//
// WHY THIS APPROACH:
//   We filter everything rigorously by `team_id` inherited from the link itself.
//   We MUST check `is_deleted: false` so guests don't bypass the recycle bin.
// ===========================================================================
export async function getTeamContent(token: string, password?: string, currentFolderId?: number | null) {
    const link = await prisma.sharedLink.findUnique({
        where: { token }
    });

    if (!link || link.file_id) {
        throw new AppError('Invalid token or not a team share', 404);
    }

    // Expiration and Limits
    if (link.expiration_date && link.expiration_date < new Date()) throw new AppError('Link expired', 410);
    if (link.password_hash) {
        if (!password) throw new AppError('Password required to view folder contents', 401);
        const isValid = await bcrypt.compare(password, link.password_hash);
        if (!isValid) throw new AppError('Invalid password', 401);
    }

    const parentFilter = currentFolderId === undefined
        ? null          // ← null in Prisma WHERE means IS NULL in SQL
        : currentFolderId;

    const [folders, files] = await Promise.all([
        prisma.folder.findMany({
            where: { team_id: link.team_id, is_deleted: false, parent_folder_id: parentFilter }
            //                                                                      ↑ was folderFilter
        }),
        prisma.file.findMany({
            where: { team_id: link.team_id, is_deleted: false, folder_id: parentFilter }
            //                                                              ↑ was folderFilter
        })
    ]);

    return { folders, files };
}

// ===========================================================================
// SERVICE FUNCTION 4: downloadSharedFile
// ===========================================================================
// PURPOSE: Securely resolve the physical disk path. Supports both Single File
//          links AND downloading specific files inside a Team share.
//
// WHY THIS APPROACH:
//   If traversing a Team Share, we explicitly re-verify that the requested
//   `requestedFileId` exactly belongs to `link.team_id` AND is not deleted.
//   An attacker cannot arbitrarily guess a random integer to download restricted files.
// ===========================================================================
export async function downloadSharedFile(token: string, password?: string, requestedFileId?: number) {
    const link = await prisma.sharedLink.findUnique({
        where: { token },
        include: { file: true }
    });

    if (!link) throw new AppError('Link not found', 404);
    if (link.expiration_date && link.expiration_date < new Date()) {
        throw new AppError('Link has expired', 410);
    }

    // Password check before touching anything else
    if (link.password_hash) {
        if (!password) throw new AppError('Password required', 401);
        const isValid = await bcrypt.compare(password, link.password_hash);
        if (!isValid) throw new AppError('Invalid password', 401);
    }

    // ✅ Atomic increment — only succeeds if still under limit
    // Do this BEFORE disk access so we never stream a file for a rejected request
    const rowsUpdated = await prisma.$executeRaw`
        UPDATE shared_links
        SET downloads_count = downloads_count + 1
        WHERE id = ${link.id}
          AND (download_limit IS NULL OR downloads_count < download_limit)
    `;

    if (rowsUpdated === 0) {
        throw new AppError('Download limit reached', 410);
    }

    // File resolution runs only after the limit check passes
    let targetFile;
    if (link.file_id && link.file) {
        targetFile = link.file;
    } else if (requestedFileId) {
        targetFile = await prisma.file.findFirst({
            where: { id: requestedFileId, team_id: link.team_id }
        });
        if (!targetFile) throw new AppError('File not found in this team', 404);
    } else {
        throw new AppError('Missing file selection for Team Share', 400);
    }

    if (targetFile.is_deleted) throw new AppError('File has been deleted', 404);

    const absolutePath = path.resolve(targetFile.storage_path);
    if (!fs.existsSync(absolutePath)) {
        throw new AppError('File is missing from disk storage', 404);
    }

    return {
        absolutePath,
        originalName: targetFile.original_name,
        mimeType: targetFile.mime_type
    };
}

// ===========================================================================
// SERVICE FUNCTION 5: revokeSharedLink
// ===========================================================================
// PURPOSE: Destroys the link prematurely from the database.
// ===========================================================================
export async function revokeSharedLink(token: string, userId: number) {
    const link = await prisma.sharedLink.findUnique({
        where: { token }
    });

    if (!link) throw new AppError('Link not found', 404);


    if (link.created_by !== userId) {
        // Will throw AppError(403) automatically if userId is not an admin
        await assertTeamMember(userId, link.team_id, 'admin');
    }


    await prisma.sharedLink.delete({
        where: { id: link.id }
    });

    void logActivity({
        teamId: link.team_id,
        userId: userId,
        action: 'link_revoked',
        targetType: link.file_id ? 'file' : 'team',
        targetId: link.file_id ?? link.team_id,
        metadata: { linkId: link.id }
    });
}
