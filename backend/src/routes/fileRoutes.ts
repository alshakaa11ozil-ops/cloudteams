// =============================================================================
// src/routes/fileRoutes.ts
// PURPOSE: Define all file-related routes and wire the middleware chain.
//          This file is the only place where route paths, HTTP methods,
//          middleware order, and controller functions are connected.
//
// MIDDLEWARE CHAIN FOR EVERY ROUTE:
//   authenticate → (multer on upload) → controller
//
// WHY authenticate on every route?
//   Files are private team resources. An unauthenticated request has no
//   userId, so we can't check team membership. Every file endpoint requires
//   a valid JWT.
//
// NOTE ON requireRole:
//   We do NOT use requireRole middleware here because the role check is
//   scoped to a specific team, and the teamId comes from req.body (upload)
//   or from the file record itself (delete). The service layer handles
//   role enforcement directly — it has access to both the userId and the
//   teamId it needs to query the team_members table.
// =============================================================================

import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { upload } from "../config/multer";
import {
    uploadFileHandler,
    getTeamFilesHandler,
    getFileByIdHandler,
    downloadFileHandler,
    softDeleteFileHandler,
    listFilesHandler,
} from "../controllers/file.controller";

import { moveFileHandler } from '../controllers/folderController';
import { createFileLinkHandler } from '../controllers/share.controller';


const router = Router();

// ---------------------------------------------------------------------------
// POST /api/files/upload
// ---------------------------------------------------------------------------
// MIDDLEWARE CHAIN: authenticate → upload.single("file") → uploadFileHandler
//
// upload.single("file") is multer middleware. It:
//   1. Reads the multipart/form-data request
//   2. Saves the file to /uploads/ on disk
//   3. Populates req.file with metadata
//   4. Calls next() so uploadFileHandler runs
//
// WHY "file" as the field name?
//   This must match the field name the client uses in the FormData object:
//     const formData = new FormData();
//     formData.append("file", selectedFile);  ← must be "file"
//   If the client uses a different name, req.file will be undefined.
//
// WHY authenticate BEFORE multer?
//   Multer saves the file to disk before we know if the user is authenticated.
//   If an unauthenticated user uploads a 50MB file, it lands on disk and wastes
//   space. By authenticating first, we reject unauthenticated requests before
//   multer even runs.
//   NOTE: Express middleware runs LEFT TO RIGHT in the array.
// ---------------------------------------------------------------------------
router.post(
    "/upload",
    authenticate,         // 1. Verify JWT — sets req.user
    upload.single("file"), // 2. Save file to disk — sets req.file
    uploadFileHandler     // 3. Hash, deduplicate, save to DB
);

// ---------------------------------------------------------------------------
// GET /api/teams/:id/files
// ---------------------------------------------------------------------------
// List all non-deleted files in a team.
// :id is the team ID — parsed inside the controller.
// No multer needed — this is a standard JSON response route.
// ---------------------------------------------------------------------------
router.get(
    "/teams/:id/files",
    authenticate,
    getTeamFilesHandler
);


router.get('/teams/:id/files', authenticate, listFilesHandler);
// ---------------------------------------------------------------------------
// GET /api/files/:id
// ---------------------------------------------------------------------------
// Get metadata for a single file.
// :id is the file ID.
// ---------------------------------------------------------------------------
router.get(
    "/:id",
    authenticate,
    getFileByIdHandler
);

// ---------------------------------------------------------------------------
// GET /api/files/:id/download
// ---------------------------------------------------------------------------
// Stream the file to the client as an attachment.
// IMPORTANT: This route must be defined BEFORE /:id or Express will match
// "/5/download" as /:id = "5/download" (wrong).
// We put it before /:id in the file but Express processes routes in
// declaration order — since "/upload" is POST and "/:id/download" is GET,
// there is no conflict. The /teams/:id/files route is also safe because
// it starts with /teams/.
// ---------------------------------------------------------------------------
router.get(
    "/:id/download",
    authenticate,
    downloadFileHandler
);

// ---------------------------------------------------------------------------
// DELETE /api/files/:id
// ---------------------------------------------------------------------------
// Soft-delete a file. Sets is_deleted = true.
// Only editors and admins can delete (enforced in the service layer).
// ---------------------------------------------------------------------------
router.delete(
    "/:id",
    authenticate,
    softDeleteFileHandler
);

// Add this route — PATCH a file to move it to a different folder

router.patch('/:id', authenticate, moveFileHandler);
router.post('/:id/share', authenticate, createFileLinkHandler);

export default router;