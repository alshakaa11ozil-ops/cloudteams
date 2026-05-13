// src/services/share.service.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity, ActivityTargetType } from '../utils/activityLogger';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';
import { extractHtmlFromYjsState } from './file.service';

// ---------------------------------------------------------------------------
// TYPES & INTERFACES
// ---------------------------------------------------------------------------
export interface CreateShareOptions {
    fileId?: number;          // Optional: If provided, shares ONE file.
    folderId?: number;        // Optional: If provided, shares ONE folder. If both omitted, shares ENTIRE TEAM.
    documentId?: number;      // Optional: If provided, shares ONE document.
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

    // 2b. Validate folder context if folderId is provided
    if (options.folderId) {
        const folder = await prisma.folder.findFirst({
            where: { id: options.folderId, team_id: teamId }
        });
        if (!folder) throw new AppError('Folder not found in this team', 404);
        if (folder.is_deleted) throw new AppError('Cannot share a deleted folder', 400);
    }

    // 2c. Validate document context if documentId is provided
    if (options.documentId) {
        const document = await prisma.documents.findFirst({
            where: { id: options.documentId, team_id: teamId }
        });
        if (!document) throw new AppError('Document not found in this team', 404);
        if (document.is_deleted) throw new AppError('Cannot share a deleted document', 400);
    }

    if ((options.fileId ? 1 : 0) + (options.folderId ? 1 : 0) + (options.documentId ? 1 : 0) > 1) {
        throw new AppError('Cannot share multiple resource types in the same link', 400);
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
            folder_id: options.folderId ?? null,
            document_id: options.documentId ?? null,
            created_by: userId,
            token,
            password_hash,
            expiration_date,
            download_limit: options.downloadLimit ?? null
        }
    });


    // 7. Fire-and-forget Audit Trail Logging.
    let targetType: ActivityTargetType = 'team';
    let targetId = teamId;
    if (options.fileId) { targetType = 'file'; targetId = options.fileId; }
    else if (options.folderId) { targetType = 'folder'; targetId = options.folderId; }
    else if (options.documentId) { targetType = 'document' as any; targetId = options.documentId; }

    void logActivity({
        teamId,
        userId,
        action: 'link_created',
        targetType,
        targetId,
        metadata: { linkId: link.id, hasPassword: !!password_hash }
    });

    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.LINK_CREATED, {
        linkId: link.id,
        token: link.token,
        createdBy: userId
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
        include: { files: true, folders: true, teams: true, documents: true }
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

    // Differentiate between File Share, Folder Share, and Team Share
    if (link.file_id && link.files) {
        // Handle Edge Case: Deleted while link was still active
        if (link.files.is_deleted) throw new AppError('The shared file has been deleted by its owner', 404);

        return {
            type: 'file',
            id: link.id,
            filename: link.files.original_name,
            fileSize: link.files.file_size,
            mimeType: link.files.mime_type,
            requiresPassword: !!link.password_hash
        };
    } else if (link.folder_id && link.folders) {
        if (link.folders.is_deleted) throw new AppError('The shared folder has been deleted by its owner', 404);

        return {
            type: 'folder',
            id: link.id,
            folderName: link.folders.name,
            requiresPassword: !!link.password_hash
        };
    } else if (link.document_id && link.documents) {
        if (link.documents.is_deleted) throw new AppError('The shared document has been deleted by its owner', 404);

        return {
            type: 'document',
            id: link.id,
            title: link.documents.title,
            requiresPassword: !!link.password_hash
        };
    } else {
        // Team Share Mode
        return {
            type: 'team',
            id: link.id,
            teamName: link.teams.name,
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

    if (!link || link.file_id || link.document_id) {
        throw new AppError('Invalid token or not a team/folder share', 404);
    }

    // Expiration and Limits
    if (link.expiration_date && link.expiration_date < new Date()) throw new AppError('Link expired', 410);
    if (link.password_hash) {
        if (!password) throw new AppError('Password required to view folder contents', 401);
        const isValid = await bcrypt.compare(password, link.password_hash);
        if (!isValid) throw new AppError('Invalid password', 401);
    }

    // Determine the root for this share
    let parentFilter: number | null;

    if (link.folder_id) {
        // FOLDER SHARE
        // Verify that the requested subfolder is a descendant of the shared folder.
        if (currentFolderId !== undefined && currentFolderId !== null && currentFolderId !== link.folder_id) {
            let tempFolderId: number | null = currentFolderId;
            let isDescendant = false;

            while (tempFolderId) {
                if (tempFolderId === link.folder_id) {
                    isDescendant = true;
                    break;
                }
                const folder = await prisma.folder.findUnique({
                    where: { id: tempFolderId }
                });
                if (!folder) break;
                tempFolderId = folder.parent_folder_id;
            }

            if (!isDescendant) {
                throw new AppError('Folder not found in this shared folder', 404);
            }
            parentFilter = currentFolderId;
        } else {
            parentFilter = link.folder_id;
        }
    } else {
        // TEAM SHARE
        parentFilter = currentFolderId === undefined ? null : currentFolderId;
    }

    const [folders, files, documents] = await Promise.all([
        prisma.folder.findMany({
            where: { team_id: link.team_id, is_deleted: false, parent_folder_id: parentFilter },
            orderBy: { name: 'asc' }
        }),
        prisma.file.findMany({
            where: { team_id: link.team_id, is_deleted: false, folder_id: parentFilter },
            orderBy: { original_name: 'asc' }
        }),
        prisma.documents.findMany({
            where: { team_id: link.team_id, is_deleted: false, folder_id: parentFilter },
            select: { id: true, title: true, created_at: true, updated_at: true, folder_id: true },
            orderBy: { title: 'asc' }
        })
    ]);

    return { folders, files, documents };
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
        include: { files: true }
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

    // File resolution runs before the limit check passes so we don't burn tokens on failures
    let targetFile;
    if (link.file_id && link.files) {
        targetFile = link.files;
    } else if (requestedFileId) {
        targetFile = await prisma.file.findFirst({
            where: { id: requestedFileId, team_id: link.team_id }
        });
        if (!targetFile) throw new AppError('File not found in this team', 404);

        // Security Check for Folder Shares: Ensure the file is actually inside the shared folder.
        // Traverse up the parent_folder_id chain to verify the file is a descendant.
        if (link.folder_id) {
            let currentFolderId = targetFile.folder_id;
            let isDescendant = false;

            while (currentFolderId) {
                if (currentFolderId === link.folder_id) {
                    isDescendant = true;
                    break;
                }
                const folder = await prisma.folder.findUnique({
                    where: { id: currentFolderId }
                });
                if (!folder) break;
                currentFolderId = folder.parent_folder_id;
            }

            if (!isDescendant) {
                throw new AppError('File not found in this shared folder', 404);
            }
        }
    } else {
        throw new AppError('Missing file selection for Team/Folder Share', 400);
    }

    if (targetFile.is_deleted) throw new AppError('File has been deleted', 404);

    const absolutePath = path.resolve(targetFile.storage_path);
    if (!fs.existsSync(absolutePath)) {
        throw new AppError('File is missing from disk storage', 404);
    }

    // ✅ Atomic increment — only succeeds if still under limit
    // Do this AFTER validating the file so failed downloads don't waste a token.
    const rowsUpdated = await prisma.$executeRaw`
        UPDATE shared_links
        SET downloads_count = downloads_count + 1
        WHERE id = ${link.id}
          AND (download_limit IS NULL OR downloads_count < download_limit)
    `;

    if (rowsUpdated === 0) {
        throw new AppError('Download limit reached', 410);
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
        targetType: link.file_id ? 'file' : (link.folder_id ? 'folder' : (link.document_id ? 'document' as any : 'team')),
        targetId: link.file_id ?? link.folder_id ?? link.document_id ?? link.team_id,
        metadata: { linkId: link.id }
    });

    // Real-time notification via helper
    emitToTeam(link.team_id, SOCKET_EVENTS.LINK_REVOKED, {
        linkId: link.id,
        revokedBy: userId
    });
}

// ===========================================================================
// SERVICE FUNCTION 6: listFileSharedLinks
// ===========================================================================
// PURPOSE: List all active share links for a specific file.
//          Enables admins to track and revoke external access.
// ===========================================================================
export async function listFileSharedLinks(userId: number, teamId: number, fileId: number) {
    // 1. Authorization: Must be a member of the team
    await assertTeamMember(userId, teamId, 'viewer');

    // 2. Fetch all links for this file
    const links = await prisma.sharedLink.findMany({
        where: { file_id: fileId, team_id: teamId },
        orderBy: { created_at: 'desc' }
    });

    return links;
}

// ===========================================================================
// SERVICE FUNCTION 7: listDocumentSharedLinks
// ===========================================================================
// PURPOSE: List all active share links for a specific document.
// ===========================================================================
export async function listDocumentSharedLinks(userId: number, teamId: number, documentId: number) {
    await assertTeamMember(userId, teamId, 'viewer');

    const links = await prisma.sharedLink.findMany({
        where: { document_id: documentId, team_id: teamId },
        orderBy: { created_at: 'desc' }
    });

    return links;
}

// ===========================================================================
// SERVICE FUNCTION 8: getSharedDocumentContent
// ===========================================================================
// PURPOSE: Return read-only HTML for a shared document link
// ===========================================================================
export async function getSharedDocumentContent(token: string, password?: string, requestedDocumentId?: number) {
    const link = await prisma.sharedLink.findUnique({
        where: { token },
        include: { documents: true }
    });

    if (!link) throw new AppError('Link not found', 404);

    if (link.expiration_date && link.expiration_date < new Date()) {
        throw new AppError('Link has expired', 410);
    }

    if (link.password_hash) {
        if (!password) throw new AppError('Password required', 401);
        const isValid = await bcrypt.compare(password, link.password_hash);
        if (!isValid) throw new AppError('Invalid password', 401);
    }

    let targetDoc;
    if (link.document_id && link.documents) {
        targetDoc = link.documents;
    } else if (requestedDocumentId) {
        targetDoc = await prisma.documents.findFirst({
            where: { id: requestedDocumentId, team_id: link.team_id }
        });
        if (!targetDoc) throw new AppError('Document not found in this team', 404);

        if (link.folder_id) {
            let currentFolderId = targetDoc.folder_id;
            let isDescendant = false;

            while (currentFolderId) {
                if (currentFolderId === link.folder_id) {
                    isDescendant = true;
                    break;
                }
                const folder = await prisma.folder.findUnique({
                    where: { id: currentFolderId }
                });
                if (!folder) break;
                currentFolderId = folder.parent_folder_id;
            }

            if (!isDescendant) {
                throw new AppError('Document not found in this shared folder', 404);
            }
        }
    } else {
        throw new AppError('Missing document selection for Team/Folder Share', 400);
    }

    if (targetDoc.is_deleted) {
        throw new AppError('The shared document has been deleted by its owner', 404);
    }

    // Atomic increment
    const rowsUpdated = await prisma.$executeRaw`
        UPDATE shared_links
        SET downloads_count = downloads_count + 1
        WHERE id = ${link.id}
          AND (download_limit IS NULL OR downloads_count < download_limit)
    `;

    if (rowsUpdated === 0) {
        throw new AppError('View limit reached', 410);
    }

    const yjsState = targetDoc.yjs_state as Buffer | null;
    let html = '<p><em>This document is empty.</em></p>';
    
    if (yjsState && yjsState.length >= 20) {
        html = extractHtmlFromYjsState(yjsState);
    }

    return {
        html,
        title: targetDoc.title
    };
}

// ===========================================================================
// SERVICE FUNCTION: revokeSharedLinkAdmin
// ===========================================================================
// PURPOSE: Delete a share link with role-aware access control.
//   - Editors can delete their OWN links (created_by === userId)
//   - Admins can delete ANY link belonging to their team
// ===========================================================================
export async function revokeSharedLinkAdmin(token: string, userId: number, teamId: number) {
    const link = await prisma.sharedLink.findUnique({ where: { token } });
    if (!link) throw new AppError('Link not found', 404);

    // Ensure the link belongs to this team (prevents cross-team manipulation)
    if (link.team_id !== teamId) throw new AppError('Link not found', 404);

    const membership = await assertTeamMember(userId, teamId, 'viewer');

    const isAdmin = membership.role === 'admin';
    const isOwner = link.created_by === userId;

    if (!isAdmin && !isOwner) {
        throw new AppError('You can only delete share links you created', 403);
    }

    await prisma.sharedLink.delete({ where: { id: link.id } });

    void logActivity({
        teamId: link.team_id,
        userId,
        action: 'link_revoked',
        targetType: link.document_id ? 'document' as any : (link.file_id ? 'file' : 'team'),
        targetId: link.document_id ?? link.file_id ?? link.team_id,
        metadata: { linkId: link.id, token }
    });

    emitToTeam(link.team_id, SOCKET_EVENTS.LINK_REVOKED, { linkId: link.id, revokedBy: userId });
}
