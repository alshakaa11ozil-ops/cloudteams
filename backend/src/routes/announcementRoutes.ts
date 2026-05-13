// ============================================================
// FILE: src/routes/announcementRoutes.ts
// PURPOSE: Define all HTTP routes for announcements.
//
// IMPORTANT — HOW THIS CONNECTS TO teamRoutes.ts:
//   These routes are mounted as a NESTED router inside teamRoutes.
//   The URL pattern is: /api/teams/:id/announcements/...
//
//   There are TWO ways to mount nested routes in Express.
//   We use Option B (mergeParams) explained below.
//
// WHY mergeParams: true?
//   This router's routes don't have /:id in them — that's the
//   TEAM id, defined in the parent teamRoutes.ts URL.
//   Without mergeParams, req.params.id would be undefined here.
//   With mergeParams: true, the parent's :id param flows down
//   into this child router automatically.
//   This is an important Express concept for nested resources.
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/requireRole';
import * as announcementController from '../controllers/announcementController';

// mergeParams: true — inherits :id (teamId) from the parent router
const router = Router({ mergeParams: true });

// ─────────────────────────────────────────────────────────────
// POST /api/teams/:id/announcements
// Create a new announcement.
// Only admins can post — editors and viewers are read-only.
// WHY requireRole('admin') here AND a check inside the service?
//   Defense in depth. The middleware catches it early (no DB hit).
//   The service catches it if this route is ever called directly
//   (e.g., from a test or another service). Two layers = safer.
// ─────────────────────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  announcementController.createAnnouncement
);

// ─────────────────────────────────────────────────────────────
// GET /api/teams/:id/announcements
// List all announcements. Pinned ones first, then newest first.
// Any team member can read — even viewers.
// ─────────────────────────────────────────────────────────────
router.get(
  '/',
  authenticate,
  requireRole('viewer'),
  announcementController.getTeamAnnouncements
);

// ─────────────────────────────────────────────────────────────
// GET /api/teams/:id/announcements/:announcementId
// Get a single announcement's full detail.
// ─────────────────────────────────────────────────────────────
router.get(
  '/:announcementId',
  authenticate,
  requireRole('viewer'),
  announcementController.getAnnouncementById
);

// ─────────────────────────────────────────────────────────────
// PATCH /api/teams/:id/announcements/:announcementId
// Edit an announcement.
// Route uses requireRole('viewer') but the SERVICE enforces the
// stricter rule (author or admin only).
// WHY 'viewer' here? Because any authenticated team member can
// attempt to edit — the service will reject them if they're not
// the author or admin. Using 'admin' here would prevent authors
// (who might be editors) from editing their own posts.
// ─────────────────────────────────────────────────────────────
router.patch(
  '/:announcementId',
  authenticate,
  requireRole('viewer'),
  announcementController.updateAnnouncement
);

// ─────────────────────────────────────────────────────────────
// DELETE /api/teams/:id/announcements/:announcementId
// Delete an announcement (hard delete).
// Same logic as PATCH — service enforces author-or-admin rule.
// ─────────────────────────────────────────────────────────────
router.delete(
  '/:announcementId',
  authenticate,
  requireRole('viewer'),
  announcementController.deleteAnnouncement
);

export default router;
