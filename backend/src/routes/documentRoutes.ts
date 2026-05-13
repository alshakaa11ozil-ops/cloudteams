// =============================================================================
// src/routes/documentRoutes.ts
//
// PURPOSE: Mount all document CRUD endpoints under /api/teams/:teamId/documents.
//
// WHY ALL ROUTES ARE TEAM-SCOPED:
//   Problem 2 & 3 from the Day 5 review — unscoped /api/documents/:docId
//   routes allow any authenticated user to rename or delete any document by
//   guessing the ID. Team-scoped routes + assertTeamMember inside the controller
//   provide the correct access control.
//
// ROUTE SUMMARY:
//   POST   /api/teams/:teamId/documents            → create blank document
//   GET    /api/teams/:teamId/documents            → list all docs in team
//   GET    /api/teams/:teamId/documents/:docId     → get single doc (for title)
//   PATCH  /api/teams/:teamId/documents/:docId     → rename
//   DELETE /api/teams/:teamId/documents/:docId     → soft delete
// =============================================================================

import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import documentVersionRoutes from './documentVersionRoutes'
import {
    createDocument,
    listDocuments,
    getDocument,
    renameDocument,
    moveDocument,
    deleteDocument,
    previewDocument,
    lockDocument,
    unlockDocument,
    forceUnlockDocument,
} from '../controllers/document.controller'
import { createDocumentLinkHandler, listDocumentLinksHandler, deleteShareLinkForDocHandler } from '../controllers/share.controller'

const router = Router({ mergeParams: true })

// All document routes require authentication
router.use(authenticate)

// Collection routes
router.post('/', createDocument)
router.get('/', listDocuments)

// Resource routes
router.get('/:docId', getDocument)
router.get('/:docId/preview', previewDocument)   // ← NEW: sidebar content preview
router.patch('/:docId', renameDocument)
router.patch('/:docId/rename', renameDocument) // Alias for consistency with files
router.patch('/:docId/move', moveDocument)
router.delete('/:docId', deleteDocument)

// Share routes
router.post('/:docId/share', createDocumentLinkHandler)
router.get('/:docId/shares', listDocumentLinksHandler)
router.delete('/:docId/shares/:token', deleteShareLinkForDocHandler)

// Lock routes
router.post('/:docId/lock', lockDocument)
router.post('/:docId/unlock', unlockDocument)
router.post('/:docId/force-unlock', forceUnlockDocument)

// Mount versioning routes
router.use('/', documentVersionRoutes)

export default router
