// ============================================================
// FILE: src/middleware/requireRole.ts
// PURPOSE: Role-based access control (RBAC) middleware.
//          After `authenticate` confirms WHO the user is,
//          this middleware confirms WHAT they are allowed to do
//          inside a specific team.
//
// WHY THIS APPROACH:
//   We separate identity (JWT) from authorization (role check).
//   This follows the principle of least privilege — users only
//   get the minimum access needed for each operation.
//
//   Role hierarchy:
//     viewer  → can only read
//     editor  → can read + write files
//     admin   → can read + write + manage team members
// ============================================================

import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

// Define the role hierarchy as a numeric scale.
// Higher number = more permissions.
// WHY a map instead of if/else chains?
// → Cleaner, easier to extend, and O(1) lookup.
const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

/**
 * requireRole — Middleware factory that returns a middleware function.
 *
 * PURPOSE: Check that the authenticated user has AT LEAST the required
 *          role in the team specified by req.params.id (teamId).
 *
 * INPUTS:
 *   minimumRole — the lowest role that can access this route
 *                 e.g., 'editor' means viewers are blocked
 *
 * OUTPUTS:
 *   Calls next() if authorized.
 *   Returns 403 Forbidden if the user lacks sufficient role.
 *   Returns 404 if the user is not a member of the team at all.
 *
 * WHY A FACTORY FUNCTION?
 *   We want to reuse this for different roles:
 *     router.post('/', authenticate, requireRole('editor'), ...)
 *     router.delete('/', authenticate, requireRole('admin'), ...)
 *   A factory lets us configure the role at route-definition time.
 */
export function requireRole(minimumRole: 'viewer' | 'editor' | 'admin') {
  // Return the actual middleware function Express will call
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // req.user is set by the `authenticate` middleware (Week 3).
      // If it doesn't exist here, authenticate wasn't applied — that's
      // a developer mistake, so we fail loudly.
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      // The teamId always comes from the URL parameter :id
      // e.g., GET /api/teams/42/members → teamId = "42"
      const teamId = parseInt(req.params.id as string, 10);

      // parseInt returns NaN for non-numeric strings — guard against that
      if (isNaN(teamId)) {
        res.status(400).json({ error: 'Invalid team ID' });
        return;
      }

      // Query the team_members table to find this user's role
      // WHY findFirst instead of findMany?
      // → There should only ever be ONE membership record per user per team
      //   (enforced by UNIQUE(team_id, user_id) in the schema).
      //   findFirst returns null if not found — perfect for our check.
      const membership = await prisma.teamMember.findFirst({
        where: {
          team_id: teamId,
          user_id: userId,
        },
        select: {
          role: true, // We only need the role — no need to fetch all columns
        },
      });

      // If membership is null, the user is NOT in this team at all.
      // Return 404 instead of 403 — WHY?
      // Security through obscurity: we don't want to confirm that a team
      // exists to someone who isn't a member. 404 reveals nothing.
      if (!membership) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }

      // Compare role levels using the hierarchy map.
      // e.g., minimumRole='editor' (level 2), user has 'viewer' (level 1)
      // → 1 < 2 → FORBIDDEN
      const userLevel = ROLE_HIERARCHY[membership.role] ?? 0;
      const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

      if (userLevel < requiredLevel) {
        res.status(403).json({
          error: 'Insufficient permissions',
          required: minimumRole,
          yourRole: membership.role,
        });
        return;
      }

      // Attach role to req so downstream controllers/services can use it
      // without hitting the database again.
      // WHY? Performance — avoid duplicate DB queries in the same request.
      req.userRole = membership.role;

      // All checks passed — hand off to the next middleware or controller
      next();
    } catch (error) {
      console.error('[requireRole] Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}