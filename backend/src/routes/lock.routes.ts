// ============================================================
// lock.routes.ts
// PURPOSE: Defines the HTTP routes for all lock operations and
//          connects them to the correct middleware chain and
//          controller function.
//
// PATTERN: Every route follows this exact chain:
//   authenticate → (requireRole if needed) → controller
//
//   authenticate  — verifies the JWT token, puts user on req.user
//   requireRole   — checks the user's role in THIS team
//   controller    — reads req, calls service, sends response
//
// WHY SEPARATE ROUTE FILE:
//   Keeps server.ts clean. Each feature owns its own route file.
//   Routes are mounted in server.ts under a base path.
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/requireRole';
import * as LockController from '../controllers/lock.controller';

const router = Router({ mergeParams: true });
// mergeParams: true is CRITICAL here.
// These routes are mounted as a sub-router under:
//   /api/teams/:teamId/files/:fileId
// Without mergeParams, req.params.teamId and req.params.fileId
// would be invisible inside this router — mergeParams makes the
// parent route params available to all child routes.

// ─── POST /api/teams/:teamId/files/:fileId/lock ──────────────
// Acquire a lease. Editor or admin only — viewers cannot lock files.
// authenticate runs first to verify JWT.
// requireRole('editor') checks the user has at least editor role
// in this team before the controller is called.
router.post(
    '/lock',
    authenticate,
    LockController.acquireLock
);

// ─── POST /api/teams/:teamId/files/:fileId/heartbeat ─────────
// Keep-alive. Any authenticated team member who owns the lock
// can send heartbeats. Role check happens inside the service
// (token validation proves ownership — no role check needed here
// beyond being a team member, which assertTeamMember handles).
router.post(
    '/heartbeat',
    authenticate,
    LockController.heartbeat
);

// ─── POST /api/teams/:teamId/files/:fileId/unlock ────────────
// Voluntary release. Same reasoning as heartbeat — token proves
// ownership, so no additional role middleware needed.
router.post(
    '/unlock',
    authenticate,
    LockController.releaseLock
);

// ─── GET /api/teams/:teamId/files/:fileId/lock-status ────────
// Read the current lock state. Any team member can check this —
// viewers need to see "Alice is editing" warnings too.
router.get(
    '/lock-status',
    authenticate,
    LockController.getLockStatus
);

// ─── POST /api/teams/:teamId/files/:fileId/force-unlock ──────
// Admin override. requireRole('admin') enforces this strictly —
// if the user is not an admin of this team, they get 403 before
// the controller is even called.
router.post(
    '/force-unlock',
    authenticate,
    requireRole('admin'),
    LockController.forceUnlock
);

export default router;
