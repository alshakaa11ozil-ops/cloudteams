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

import multer from "multer";
import path from "path";
import fs from "fs";

// ---------------------------------------------------------------------------
// ENSURE THE UPLOADS DIRECTORY EXISTS
// ---------------------------------------------------------------------------
// WHY: If the /uploads folder doesn't exist when the server starts, the first
// upload attempt will crash with ENOENT (no such file or directory).
// fs.mkdirSync with { recursive: true } creates the folder AND any missing
// parent folders in one call. The `recursive` flag means it won't throw an
// error if the folder already exists — safe to call every time on startup.
// ---------------------------------------------------------------------------
const UPLOADS_DIR = "uploads"; // relative to project root (where server runs)
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// DISK STORAGE CONFIGURATION
// ---------------------------------------------------------------------------
// multer.diskStorage() accepts two functions:
//   destination → where on disk to save the file
//   filename    → what to name the saved file
// Both functions follow Node.js callback convention: cb(error, value).
// Pass null as the first argument to signal no error.
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
    // PURPOSE: Tell multer which folder to save files into.
    // INPUTS:  req (the Express request), file (multer file object), cb (callback)
    // OUTPUTS: calls cb(null, directoryPath) to confirm destination
    destination: (_req, _file, cb) => {
        cb(null, UPLOADS_DIR); // save all uploads to the /uploads folder
    },

    // PURPOSE: Generate a safe, unique filename for each uploaded file.
    // INPUTS:  req, file (contains file.originalname and file.mimetype), cb
    // OUTPUTS: calls cb(null, filename) with the generated safe filename
    //
    // WHY Date.now() as prefix?
    //   Date.now() returns milliseconds since Jan 1, 1970 — e.g. 1710000000000.
    //   Two files uploaded in the same millisecond would collide, but in practice
    //   this is extremely unlikely for a single-server graduation project.
    //   A production system would use a UUID (crypto.randomUUID()) instead.
    //
    // WHY path.extname()?
    //   path.extname("My Resume.pdf") returns ".pdf".
    //   We preserve the extension so the OS and browsers know the file type.
    //   Without it, the file would have no extension and be unrecognisable.
    //
    // EXAMPLE: "My Resume (FINAL v3).pdf" → "1710000000000-My Resume (FINAL v3).pdf"
    //   The timestamp prefix makes it unique; the original name is kept for
    //   human readability (though we never expose this path to users directly).
    filename: (_req, file, cb) => {
        const timestamp = Date.now(); // e.g. 1710000000000
        const ext = path.extname(file.originalname); // e.g. ".pdf"
        const safeName = `${timestamp}-${file.originalname}`; // e.g. "1710000000000-resume.pdf"
        cb(null, safeName);
    },
});

// ---------------------------------------------------------------------------
// FILE FILTER — OPTIONAL SECURITY LAYER
// ---------------------------------------------------------------------------
// PURPOSE: Reject dangerous file types before they touch disk.
// WHY: Storing executable files (.exe, .sh, .bat) or server-side scripts
//      (.php, .py) on your server is a security risk even if you never execute
//      them — a misconfigured server could serve them directly.
//      For a graduation project this is defensive-in-depth: unlikely to be
//      exploited, but shows security awareness to your committee.
//
// HOW IT WORKS:
//   cb(null, true)  → accept the file
//   cb(null, false) → reject the file silently (multer will set req.file = undefined)
//   cb(error)       → reject with an error (we use this to send a clear message)
// ---------------------------------------------------------------------------
const BLOCKED_MIME_TYPES = [
    "application/x-executable",
    "application/x-sh",
    "application/x-bat",
    "application/x-php",
    "text/x-script.python",
];

const fileFilter = (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
) => {
    if (BLOCKED_MIME_TYPES.includes(file.mimetype)) {
        // Reject with a typed error so the controller can catch it and return 400
        cb(new Error(`File type '${file.mimetype}' is not allowed`));
    } else {
        cb(null, true); // accept all other file types
    }
};

// ---------------------------------------------------------------------------
// ASSEMBLE THE MULTER INSTANCE
// ---------------------------------------------------------------------------
// PURPOSE: Combine storage config, size limit, and file filter into one
//          reusable multer instance that all upload routes will use.
//
// limits.fileSize: 50 * 1024 * 1024 = 52,428,800 bytes = 50 MB
//   WHY: Without a limit, a single malicious or accidental upload could
//        fill your entire disk. 50MB covers PDFs, presentations, images,
//        spreadsheets — everything a student team needs.
//   WHAT HAPPENS IF EXCEEDED: Multer throws a MulterError with code
//   'LIMIT_FILE_SIZE' which we catch in the controller and return HTTP 413.
// ---------------------------------------------------------------------------
export const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB in bytes
    },
    fileFilter,
});

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
// We also export UPLOADS_DIR so the download endpoint can build absolute
// paths without duplicating the string "uploads" in multiple files.
// Single source of truth: change it here, everything updates.
// ---------------------------------------------------------------------------
export { UPLOADS_DIR };