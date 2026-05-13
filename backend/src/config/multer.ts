// =============================================================================
// src/config/multer.ts
// PURPOSE: Configure multer middleware to handle multipart/form-data file
//          uploads. Saves files to local disk under the /uploads directory
//          with safe, collision-resistant filenames.
//
// WHY THIS FILE EXISTS: Express cannot parse binary file data on its own.
// Multer intercepts the multipart request, saves the file to disk, and
// populates req.file with metadata (original name, size, mime type, path).
// All upload endpoints import the `upload` object from this file.
//
// WHY DISK STORAGE (not memoryStorage):
//   memoryStorage() holds the entire file in RAM as a Buffer.
//   A 50MB upload = 50MB of RAM consumed for the full duration of the request.
//   diskStorage() streams the file directly to disk — RAM usage stays near zero.
//   For a server handling multiple concurrent uploads, disk storage is essential.
// =============================================================================


// src/config/multer.ts
import multer from 'multer';

// memoryStorage keeps the uploaded file as req.file.buffer in RAM.
// Nothing is written to disk. The buffer goes straight to R2, then
// gets garbage collected. This is required for Railway where the
// filesystem is ephemeral and wiped on every deploy.
const storage = multer.memoryStorage();

// ---------------------------------------------------------------------------
// FILE FILTER — SECURITY LAYER
// ---------------------------------------------------------------------------
// PURPOSE: Reject dangerous file types before they reach R2.
// WHY: Even though we never execute uploaded files, storing executables
//      and server-side scripts is a security risk — a misconfigured server
//      could serve them directly. This shows defensive-in-depth design.
//
// HOW IT WORKS:
//   cb(null, true)  → accept the file
//   cb(error)       → reject with a typed error the controller can catch
// ---------------------------------------------------------------------------
const BLOCKED_MIME_TYPES = [
    'application/x-executable',
    'application/x-sh',
    'application/x-bat',
    'application/x-php',
    'text/x-script.python',
];

const fileFilter = (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
) => {
    if (BLOCKED_MIME_TYPES.includes(file.mimetype)) {
        // Reject with a typed error so the controller can return 400
        cb(new Error(`File type '${file.mimetype}' is not allowed`));
    } else {
        cb(null, true);
    }
};

// Export a single configured Multer instance used by all upload routes.
// memoryStorage + fileFilter + 50MB limit is the complete upload policy.
export const upload = multer({
    storage,           // memory, not disk — buffer goes straight to R2
    fileFilter,        // block dangerous MIME types
    limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB
    },
});
