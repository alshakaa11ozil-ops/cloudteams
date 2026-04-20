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
    getDownloadPath,
    softDeleteFile,
    FileNotFoundError,
    ForbiddenError,
    listFiles,
    renameFile,        // ← NEW: Week 12 rename feature
    getFilePreview,
} from "../services/file.service";
import multer from "multer"; // imported for MulterError instanceof check.



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
        const { file, isDuplicate } = await uploadFile(
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
export const downloadFileHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const fileId = parseInt(req.params.id as string, 10);
        if (isNaN(fileId)) {
            res.status(400).json({ error: "Invalid file ID" });
            return;
        }

        const { absolutePath, originalName } = await getDownloadPath(
            fileId,
            req.user!.userId
        );

        // res.download(path, filename, callback)
        //   path         → absolute path on disk to the file
        //   originalName → the filename the browser will use when saving
        //   callback     → called when streaming is complete (or if it errors)
        //
        // The callback handles errors that occur MID-STREAM (after headers are sent).
        // At that point we can't change the status code, but we log the error.
        res.download(absolutePath, originalName, (err) => {
            if (err) {
                // Headers may already be sent — can't send a JSON error response here
                // Just log it. The partial download will fail on the client side.
                console.error("[downloadFileHandler] Stream error:", err);
            }
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

        console.error("[downloadFileHandler] Unexpected error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};


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
        if (previewData.streamable && previewData.storagePath) {
            res.setHeader('Content-Type', previewData.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', 'inline');
            const fs = require('fs');
            const stream = fs.createReadStream(previewData.storagePath);
            stream.pipe(res);
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