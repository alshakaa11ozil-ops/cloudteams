// =============================================================================
// src/controllers/file.controller.ts
// PURPOSE: HTTP layer for all file operations. Reads from req, calls the
//          file service, and sends the correct HTTP response.
//
// ARCHITECTURE RULE: Controllers must be THIN.
//   ✅ Read req.body, req.params, req.file, req.user
//   ✅ Call one service function
//   ✅ Send res with correct status code
//   ❌ No business logic
//   ❌ No direct Prisma calls
//   ❌ No filesystem operations
//
// ERROR MAPPING:
//   FileNotFoundError → 404
//   ForbiddenError    → 403
//   MulterError (LIMIT_FILE_SIZE) → 413
//   Everything else   → 500
// =============================================================================

import { Request, Response } from "express";
import {
    uploadFile,
    getTeamFiles,
    getFileById,
    getFileForDownload,
    softDeleteFile,
    FileNotFoundError,
    ForbiddenError,
    listFiles,
    renameFile,        // ← NEW: Week 12 rename feature
    getFilePreview,
} from "../services/file.service";
import multer from "multer"; // imported for MulterError instanceof check.
import prisma from "../config/database";
import { File as PrismaFile } from '../generated/prisma';
import { AppError, assertTeamMember } from '../utils/teamGuard';



// ---------------------------------------------------------------------------
// CONTROLLER 1: uploadFileHandler
// ---------------------------------------------------------------------------
// PURPOSE: Receive a multipart file upload, pass it to the service for
//          hashing and deduplication, and return the created file record.
//
// ROUTE:   POST /api/files/upload
// MIDDLEWARE CHAIN: authenticate → requireRole (applied in routes) → this
//
// req.file  — populated by multer middleware (filename, path, size, etc.)
// req.body  — contains teamId (required) and folderId (optional)
// req.user  — populated by authenticate middleware ({ userId, email })
//
// HTTP RESPONSES:
//   201 — file uploaded or duplicate reference created
//   400 — no file attached, or teamId missing
//   413 — file exceeds 50MB limit (multer throws this before we get here)
//   500 — unexpected server error
// ---------------------------------------------------------------------------
export const uploadFileHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        // req.file is undefined if multer found no file in the request
        // This happens if the client sent JSON instead of multipart/form-data,
        // or forgot to include the file field named "file"
        if (!req.file) {
            res.status(400).json({
                error: "No file attached. Send a multipart/form-data request with a 'file' field.",
            });
            return;
        }

        // teamId comes from req.body as a STRING (multipart/form-data encodes
        // everything as strings, even numbers). parseInt converts it.
        // parseInt("abc") returns NaN — we check for that explicitly.
        const teamId = parseInt(req.body.teamId, 10);
        if (isNaN(teamId)) {
            res.status(400).json({
                error: "teamId is required and must be a number",
            });
            return;
        }

        // folderId is optional — only parse if it was provided
        // req.body.folderId could be undefined (not sent) or "5" (sent as string)
        const folderId = req.body.folderId
            ? parseInt(req.body.folderId, 10)
            : undefined;
        // In any controller that passes ip/userAgent to a service:

        // WHY x-forwarded-for: when Express sits behind a reverse proxy (Nginx, 
        // Heroku router, Railway), the real client IP is in this header.
        // req.ip alone returns the proxy's address, not the user's address.
        // We fall through to req.ip as the final fallback for direct connections.
        const ip =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
            req.ip ??
            'unknown'

        // WHY split(',')[0]: x-forwarded-for can contain multiple IPs if the
        // request passed through multiple proxies: "clientIP, proxy1, proxy2"
        // We only want the first one — that's the original client.

        const userAgent = (req.headers['user-agent'] as string) ?? 'unknown'
        // Fallback for mime_type: multer fills this from the request Content-Type.
        // If the browser sends an empty string, we default to "application/octet-stream"
        // which is the generic "unknown binary" MIME type — safe and honest.
        const mimeType = req.file.mimetype || "application/octet-stream";

        // Build a corrected multer file object with the guaranteed mime_type
        // We spread req.file to preserve all other fields (filename, path, size, etc.)
        const multerFile = { ...req.file, mimetype: mimeType };

        // Delegate all logic to the service
        const { file, isDuplicate, duplicateReason } = await uploadFile(
            multerFile,
            teamId,
            req.user!.userId,
            ip,
            userAgent,
            folderId
        );

        // 201 Created — whether it's a new file or a duplicate reference
        // isDuplicate gives the client useful context without changing the status code
        res.status(201).json({
            message: isDuplicate
                ? "File already exists in this team — reference created"
                : "File uploaded successfully",
            isDuplicate,
            duplicateReason,
            file,
        });

    } catch (err) {
        // multer throws MulterError for limit violations (file too large, too many files)
        // LIMIT_FILE_SIZE is the specific code for our 50MB limit
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
                res.status(413).json({
                    error: "File too large. Maximum size is 50MB.",
                });
                return;
            }
            // Other multer errors (LIMIT_UNEXPECTED_FILE = wrong field name, etc.)
            res.status(400).json({ error: `Upload error: ${err.message}` });
            return;
        }

        if (err instanceof ForbiddenError) {
            res.status(403).json({ error: err.message });
            return;
        }

        // Unexpected error — log it server-side, don't expose internals to client
        console.error("[uploadFileHandler] Unexpected error:", err);
        res.status(500).json({ error: "Internal server error during upload" });
    }
};



// ---------------------------------------------------------------------------
// CONTROLLER 2: getTeamFilesHandler
// ---------------------------------------------------------------------------
// PURPOSE: Return all non-deleted files belonging to a team.
//
// ROUTE:  GET /api/teams/:id/files
//
// req.params.id — the team ID (comes as a string, must parse to number)
// req.user      — authenticated user
//
// HTTP RESPONSES:
//   200 — array of files (empty array is valid — team just has no files)
//   403 — user is not in this team
//   500 — unexpected error
// ---------------------------------------------------------------------------
export const getTeamFilesHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const teamId = parseInt(req.params.id as string, 10);
        if (isNaN(teamId)) {
            res.status(400).json({ error: "Invalid team ID" });
            return;
        }

        const files = await getTeamFiles(teamId, req.user!.userId);

        // Always 200, even if files array is empty.
        // An empty array means the team exists but has no files — not an error.
        res.status(200).json({ files });
    } catch (err) {
        if (err instanceof ForbiddenError) {
            res.status(403).json({ error: err.message });
            return;
        }

        console.error("[getTeamFilesHandler] Unexpected error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 3: getFileByIdHandler
// ---------------------------------------------------------------------------
// PURPOSE: Return metadata for a single file.
//
// ROUTE:  GET /api/files/:id
//
// HTTP RESPONSES:
//   200 — file metadata object
//   404 — file not found or soft-deleted
//   403 — user not in the file's team
//   500 — unexpected error
// ---------------------------------------------------------------------------
export const getFileByIdHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10);
        if (isNaN(fileId)) {
            res.status(400).json({ error: "Invalid file ID" });
            return;
        }

        const file = await getFileById(fileId, req.user!.userId);

        res.status(200).json({ file });
    } catch (err) {
        if (err instanceof FileNotFoundError) {
            res.status(404).json({ error: err.message });
            return;
        }

        if (err instanceof ForbiddenError) {
            res.status(403).json({ error: err.message });
            return;
        }

        console.error("[getFileByIdHandler] Unexpected error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 4: downloadFileHandler
// ---------------------------------------------------------------------------
// PURPOSE: Stream a file from disk to the client with the correct filename.
//
// ROUTE:  GET /api/files/:id/download
//
// WHY res.download() and not res.sendFile()?
//   res.sendFile() lets the browser decide what to do — it may open a PDF
//   in a browser tab instead of saving it. res.download() sets the header:
//     Content-Disposition: attachment; filename="Original Name.pdf"
//   This forces the browser to save the file with the user's original filename,
//   not the internal timestamp-prefixed name we use for storage.
//
// HTTP RESPONSES:
//   200 (implicit) — file stream begins, browser downloads it
//   404 — file not found in DB or missing from disk
//   403 — user not in file's team
//   500 — unexpected error
// ---------------------------------------------------------------------------
// In file.controller.ts download handler:

// In file.controller.ts download handler:

export const downloadFileHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10)
        const teamId = parseInt(req.query.teamId as string, 10)
        const userId = req.user!.userId

        const { buffer, storagePath, file } = await getFileForDownload(fileId, teamId, userId)

        // Set filename header for browser download dialog
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(file.original_name)}"`
        )
        res.setHeader('Content-Type', file.mime_type ?? 'application/octet-stream')

        if (buffer) {
            // Encrypted file — send decrypted buffer directly
            // WHY BUFFER NOT FILE: The file on disk is encrypted ciphertext.
            // We send the decrypted plaintext bytes to the client.
            res.setHeader('Content-Length', buffer.length)
            res.send(buffer)
        } else if (storagePath) {
            // Legacy unencrypted file — stream from disk
            res.sendFile(storagePath)
        }

    } catch (err) {
        if (err instanceof AppError) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        console.error('[downloadFileHandler]', err)
        res.status(500).json({ error: 'Download failed' })
    }
}
// CONTROLLER: listFilesHandler
// Route: GET /api/teams/:id/files
// Optional query params:
//   ?folderId=3     → files inside folder 3
//   ?folderId=null  → root-level files only
//   (omitted)       → all files in the team
export async function listFilesHandler(req: Request, res: Response) {
    try {
        const userId = req.user!.userId;
        const teamId = parseInt(req.params.id as string, 10);

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID' });
            return;
        }

        // Parse the optional folderId query param
        // Three possible values from the URL:
        //   not present → undefined (no filter)
        //   "null"      → null (root level only)
        //   "3"         → 3 (specific folder)
        let folderId: number | null | undefined;

        if (req.query.folderId === undefined) {
            folderId = undefined; // no filter
        } else if (req.query.folderId === 'null') {
            folderId = null; // root level
        } else {
            const parsed = parseInt(req.query.folderId as string, 10);
            // If the value isn't a valid number, ignore the filter
            folderId = isNaN(parsed) ? undefined : parsed;
        }

        const files = await listFiles(teamId, userId, folderId);
        res.status(200).json({ files });
    } catch (error) {
        console.error('[listFilesHandler]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
// ---------------------------------------------------------------------------
// CONTROLLER 5: softDeleteFileHandler
// ---------------------------------------------------------------------------
// PURPOSE: Soft-delete a file (is_deleted = true). File stays in DB and on
//          disk for recycle bin recovery (Week 12).
//
// ROUTE:  DELETE /api/files/:id
//
// HTTP RESPONSES:
//   200 — file soft-deleted successfully
//   404 — file not found or already deleted
//   403 — user lacks editor/admin role
//   500 — unexpected error
// ---------------------------------------------------------------------------
export const softDeleteFileHandler = async (
    req: Request,
    res: Response

): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10);
        if (isNaN(fileId)) {
            res.status(400).json({ error: "Invalid file ID" });
            return;
        }
        const ip =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
            req.ip ??
            'unknown'

        // WHY split(',')[0]: x-forwarded-for can contain multiple IPs if the
        // request passed through multiple proxies: "clientIP, proxy1, proxy2"
        // We only want the first one — that's the original client.

        const userAgent = (req.headers['user-agent'] as string) ?? 'unknown'
        await softDeleteFile(
            fileId,
            req.user!.userId,
            ip,
            userAgent
        );

        res.status(200).json({
            message: "File deleted. It can be recovered from the recycle bin for 30 days.",
        });
    } catch (err) {
        if (err instanceof FileNotFoundError) {
            res.status(404).json({ error: err.message });
            return;
        }

        if (err instanceof ForbiddenError) {
            res.status(403).json({ error: err.message });
            return;
        }

        console.error("[softDeleteFileHandler] Unexpected error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 6: renameFileHandler
// ---------------------------------------------------------------------------
// PURPOSE: Update the display name of a file (original_name field).
//          The actual storage filename on disk is never changed.
//
// ROUTE:  PATCH /api/files/:id/rename
// BODY:   { newName: string, teamId: number }
//
// HTTP RESPONSES:
//   200 — { message, file } — file with updated original_name
//   400 — missing newName or teamId
//   403 — user is viewer (no write permission)
//   404 — file not found or belongs to different team
// ---------------------------------------------------------------------------
export const renameFileHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10);
        const teamId = parseInt(req.body.teamId, 10);
        const { newName } = req.body;
        // In any controller that passes ip/userAgent to a service:

        // WHY x-forwarded-for: when Express sits behind a reverse proxy (Nginx, 
        // Heroku router, Railway), the real client IP is in this header.
        // req.ip alone returns the proxy's address, not the user's address.
        // We fall through to req.ip as the final fallback for direct connections.
        const ip =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
            req.ip ??
            'unknown'

        // WHY split(',')[0]: x-forwarded-for can contain multiple IPs if the
        // request passed through multiple proxies: "clientIP, proxy1, proxy2"
        // We only want the first one — that's the original client.

        const userAgent = (req.headers['user-agent'] as string) ?? 'unknown'

        if (isNaN(fileId) || isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid fileId or teamId' });
            return;
        }
        if (!newName || typeof newName !== 'string' || !newName.trim()) {
            res.status(400).json({ error: 'newName is required' });
            return;
        }

        const file = await renameFile(
            fileId,
            newName,
            teamId,
            req.user!.userId,
            ip,
            userAgent
        );

        res.status(200).json({ message: 'File renamed successfully', file });
    } catch (err: any) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        if (err instanceof ForbiddenError) {
            res.status(403).json({ error: err.message });
            return;
        }
        if (err instanceof FileNotFoundError) {
            res.status(404).json({ error: err.message });
            return;
        }
        console.error('[renameFileHandler] Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 7: previewFileHandler
// ---------------------------------------------------------------------------
// PURPOSE: Stream image/PDF directly to browser (inline) or return HTML
//          for document previews.
//
// ROUTE:  GET /api/files/:id/preview?teamId=X
// ---------------------------------------------------------------------------
export const previewFileHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10);
        // Important: req.query.teamId lets us verify access within a team context
        const teamId = parseInt(req.query.teamId as string, 10);

        if (isNaN(fileId) || isNaN(teamId)) {
            res.status(400).json({ error: "Invalid file ID or team ID parameter missing" });
            return;
        }

        const previewData = await getFilePreview(fileId, req.user!.userId, teamId);

        // Native streaming (PDFs / Images)
        if (previewData.streamable) {
            res.setHeader('Content-Type', previewData.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', 'inline');

            if (previewData.buffer) {
                // Encrypted: send the decrypted buffer directly
                res.setHeader('Content-Length', previewData.buffer.length);
                res.send(previewData.buffer);
            } else if (previewData.storagePath) {
                // Unencrypted: stream from disk
                const fs = require('fs');
                const stream = fs.createReadStream(previewData.storagePath);
                stream.pipe(res);
            }
            return;
        }

        // Converted JSON blocks (HTML representation) or fallback false
        res.status(200).json(previewData);
    } catch (err: any) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        if (err instanceof FileNotFoundError) {
            res.status(404).json({ error: err.message });
            return;
        }
        if (err instanceof ForbiddenError) {
            res.status(403).json({ error: err.message });
            return;
        }

        console.error("[previewFileHandler] Unexpected error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ---------------------------------------------------------------------------
// CONTROLLER 8: openEditorHandler
// ---------------------------------------------------------------------------
// PURPOSE: Called before the collaborative editor opens for an existing file.
//          Reads the file content from disk and returns it so the frontend
//          can initialize the TipTap editor with real content on FIRST OPEN.
//
// ROUTE:   GET /api/files/:id/open-editor?teamId=X
//
// HOW IT WORKS — TWO PATHS:
//   PATH A — File already has yjs_state in DB (was edited before):
//     Return { hasExistingState: true } — the frontend just connects to
//     Hocuspocus and loads the saved Yjs state. No file reading needed.
//
//   PATH B — No yjs_state yet (first time opening this file in the editor):
//     1. Read the file from disk
//     2. For .txt / .md: return raw text — TipTap will insert it as paragraphs
//     3. For .docx: run through mammoth to produce HTML — TipTap will parse it
//     The frontend inserts this content into the Yjs doc via editor.commands.
//     After first insertion, Hocuspocus auto-saves it → no longer "first open".
//
// WHY RETURN HTML FOR DOCX (not binary):
//   Yjs syncs the document's text/rich-text representation, not the binary file.
//   mammoth converts .docx → clean HTML (headings, bold, lists preserved).
//   TipTap understands HTML natively. All collaborators get the formatted content.
//
// WHY THIS IS A GET NOT POST:
//   We're reading data only — no mutations. The Yjs state save happens
//   independently via Hocuspocus's store() hook every 5 seconds.
//
// HTTP RESPONSES:
//   200 — { hasExistingState, content?, contentType? }
//   400 — invalid fileId or missing teamId
//   403 — user not in the file's team
//   404 — file not found or unsupported type
//   500 — unexpected error
// ---------------------------------------------------------------------------
export const openEditorHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10)
        const teamId = parseInt(req.query.teamId as string, 10)
        const userId = req.user!.userId

        if (isNaN(fileId) || isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid fileId or teamId' })
            return
        }

        // Load the file record from DB — verifies the file exists and isn't deleted.
        // This also gives us storage_path, mime_type, and yjs_state.
        const file = await prisma.file.findFirst({
            where: { id: fileId, is_deleted: false },
            select: {
                id: true,
                team_id: true,
                storage_path: true,
                original_name: true,
                mime_type: true,
                yjs_state: true,
            }
        })

        if (!file) {
            res.status(404).json({ error: 'File not found or has been deleted' })
            return
        }

        // Verify the user is a member of the team that owns this file.
        // WHY NOT use middleware: teamId comes from the file record itself,
        // not from a URL param we can middleware-check before the DB query.
        if (file.team_id !== teamId) {
            res.status(403).json({ error: 'File does not belong to this team' })
            return
        }

        try {
            // Using the shared guard to verify team membership.
            // Throws an AppError with 403 if the user is not in the team.
            await assertTeamMember(userId, teamId, 'viewer')
        } catch (error: any) {
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ error: error.message })
                return
            }
            throw error
        }

        // Verify the file format is supported for collaborative editing
        const EDITABLE_EXTENSIONS = ['.txt', '.md', '.docx']
        const isEditable = EDITABLE_EXTENSIONS.some(e => file.original_name.toLowerCase().endsWith(e))

        if (!isEditable) {
            res.status(400).json({
                error: `"${file.original_name}" cannot be edited collaboratively. Supported formats: .txt, .md, .docx`,
                supportedFormats: EDITABLE_EXTENSIONS
            })
            return
        }

        // PATH A: Yjs state already exists — editor has been used before.
        // The frontend should just connect to Hocuspocus and load the Yjs state.
        // No need to read the file from disk — Hocuspocus's fetch() handles it.
        if (file.yjs_state) {
            res.status(200).json({
                hasExistingState: true,
                fileName: file.original_name,
                fileId: file.id
            })
            return
        }

        // PATH B: First time opening — read file content and return it.
        // The file extension determines how we read and convert it.
        const name = file.original_name.toLowerCase()
        const fs = await import('fs/promises')

        if (name.endsWith('.txt') || name.endsWith('.md')) {
            // Plain text / Markdown — read raw UTF-8 content.
            // WHY raw text for .md: TipTap does not natively parse Markdown syntax.
            // We return it as plain text. The Markdown formatting (# headings, **bold**)
            // will appear as literal characters — that's acceptable for Day 2.
            // Day 4 (Slash commands) can add a proper Markdown import extension.
            const content = await fs.readFile(file.storage_path, 'utf-8')
            res.status(200).json({
                hasExistingState: false,
                contentType: 'text',   // frontend inserts as plain text paragraphs
                content,
                fileName: file.original_name,
            })

        } else if (name.endsWith('.docx')) {
            // Word document — convert to HTML using mammoth.
            // WHY mammoth: It converts .docx → clean semantic HTML.
            // Preserves headings (h1-h6), bold, italic, lists, tables.
            // TipTap's setContent(html) parses this HTML natively.
            // We pass { styleMap: [] } to avoid class-based styles — TipTap uses marks.
            const mammoth = await import('mammoth')
            const fileBuffer = await fs.readFile(file.storage_path)
            const { value: html } = await mammoth.convertToHtml(
                { buffer: fileBuffer },
                {
                    // Convert Word heading styles to semantic HTML headings
                    styleMap: [
                        "p[style-name='Heading 1'] => h1:fresh",
                        "p[style-name='Heading 2'] => h2:fresh",
                        "p[style-name='Heading 3'] => h3:fresh",
                    ]
                }
            )
            res.status(200).json({
                hasExistingState: false,
                contentType: 'html',   // frontend uses editor.commands.setContent(html)
                content: html,
                fileName: file.original_name,
            })

        } else {
            // Unsupported file type — not editable as text/rich-text.
            // Only .txt, .md, .docx are supported by the collaborative editor.
            res.status(404).json({
                error: `File type not supported for editing. Supported: .txt, .md, .docx`
            })
        }

    } catch (err: any) {
        console.error('[openEditorHandler]', err)
        res.status(500).json({ error: 'Failed to open file for editing' })
    }
}
