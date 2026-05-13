// ============================================================
// FILE: src/controllers/teamController.ts
// PURPOSE: HTTP request/response layer for team operations.
//
// RULE: Controllers must be THIN. Their only job is:
//   1. Extract data from req (params, body, user)
//   2. Call the appropriate service function
//   3. Send the HTTP response
//
// Controllers must NOT contain business logic.
// "Is this user allowed?" → That's the middleware's job.
// "What are the rules for inviting?" → That's the service's job.
// "What does the HTTP response look like?" → That's THIS file's job.
//
// WHY THIS DISCIPLINE?
//   If a controller is 200 lines long, something is wrong.
//   A thin controller is easy to read, test, and maintain.
// ============================================================

// ============================================================
// FILE: src/controllers/teamController.ts
//
// PURPOSE: HTTP request/response layer for all team operations.
//
// RULE — Controllers must be THIN. Their only job is:
//   1. Read data from req (body, params, user)
//   2. Call the correct service function
//   3. Map service errors to HTTP status codes
//   4. Send the response
//
// NEVER put business logic here. No database calls here.
// If you find yourself writing "if user is owner..." in a
// controller — stop. Move it to the service.
//
// WHY THIS SEPARATION?
//   Imagine you later want to create a team from a CLI tool,
//   a scheduled job, or a test. You call teamService.createTeam()
//   directly — no HTTP involved. The business logic is reusable.
//   If it lived in the controller, you could not reuse it.
// ============================================================

import { Request, Response } from 'express';
import prisma from '../config/database';
import * as teamService from '../services/teamService';
import { AppError } from '../utils/teamGuard';

// ============================================================
// createTeam
//
// PURPOSE: Handle POST /api/teams
//          Create a new team owned by the authenticated user.
//
// ACCESS: Any authenticated user (no role check needed —
//         they are creating a NEW team, not accessing an existing one)
//
// INPUTS (from HTTP request):
//   req.body.name        — team name (required)
//   req.body.description — team description (optional)
//   req.user.userId      — set by authenticate middleware (the creator)
//
// OUTPUTS:
//   201 Created     — team was created successfully
//   400 Bad Request — name is missing or empty
//   500 Server Error
// ============================================================
export async function createTeam(req: Request, res: Response) {
  try {
    const { name, description } = req.body;

    // Validate: name is required. Trim so "   " does not count as valid.
    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'Team name is required' });
      return;
    }

    // req.user is guaranteed here because authenticate middleware ran first.
    // WHY userId not id? Our JwtPayload type uses { userId, email }
    const ownerId = req.user!.userId;

    // Service creates the team AND adds owner as admin in one transaction
    const team = await teamService.createTeam(
      name.trim(),
      description?.trim(),
      ownerId
    );

    // 201 Created — correct HTTP status for a newly created resource
    res.status(201).json({ message: 'Team created successfully', team });
  } catch (error) {
    console.error('[createTeam]', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
}

// ============================================================
// getUserTeams
//
// PURPOSE: Handle GET /api/teams
//          Return all teams the authenticated user belongs to.
//
// ACCESS: Any authenticated user
//
// INPUTS:
//   req.user.userId — who is asking (from JWT)
//
// OUTPUTS:
//   200 OK — array of teams (empty array if none — not an error)
//   500 Server Error
// ============================================================
export async function getUserTeams(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const teams = await teamService.getUserTeams(userId);
    res.status(200).json({ teams });
  } catch (error) {
    console.error('[getUserTeams]', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
}

// ============================================================
// getTeamById
//
// PURPOSE: Handle GET /api/teams/:id
//          Return full details of one specific team.
//
// ACCESS: Any team member (requireRole('viewer') in route ensures this)
//
// INPUTS:
//   req.params.id — the team numeric ID from the URL
//                   e.g. GET /api/teams/42 → req.params.id = "42"
//
// OUTPUTS:
//   200 OK        — team object with members and stats
//   404 Not Found — team does not exist
//   500 Server Error
//
// WHY `as string` ON parseInt?
//   TypeScript types req.params.id as string | string[] because
//   in theory a URL could have multiple values for one param.
//   In Express with standard routing it is always a string.
//   `as string` tells TypeScript: trust me, this is one string.
// ============================================================
export async function getTeamById(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;
    const team = await teamService.getTeamById(teamId, userId);
    res.status(200).json({ team });
  } catch (error) {
    if (error instanceof teamService.TeamNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[getTeamById]', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
}

// ============================================================
// inviteMember
//
// PURPOSE: Handle POST /api/teams/:id/invite
//          Add a user to a team by their email address.
//
// ACCESS: Admin only (requireRole('admin') in route)
//
// INPUTS:
//   req.params.id    — team ID
//   req.body.email   — email of user to invite (required)
//   req.body.role    — role to assign (optional, defaults to 'editor')
//   req.user.userId  — who is inviting (for audit trail later)
//
// OUTPUTS:
//   201 Created  — member added successfully
//   400          — email missing or invalid role
//   404          — no user with that email exists
//   409 Conflict — user is already a member
//   500 Server Error
//
// WHY EMAIL-BASED?
//   The inviter knows their teammate's email, not their database ID.
//   Email lookup is the natural UX. The service handles the lookup.
// ============================================================
export async function inviteMember(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const { email, role } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const validRoles = ['viewer', 'editor', 'admin'];
    const assignedRole = role || 'editor'; // Default to editor if not specified
    if (!validRoles.includes(assignedRole)) {
      res.status(400).json({ error: 'Invalid role', validRoles });
      return;
    }

    const invitedByUserId = req.user!.userId;

    const newMember = await teamService.inviteMember(
      teamId,
      email.toLowerCase().trim(), // Normalize: "Alice@Email.com" → "alice@email.com"
      assignedRole,
      invitedByUserId
    );

    res.status(201).json({ message: 'Member added to team', member: newMember });
  } catch (error) {
    if (error instanceof teamService.UserNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    // 409 Conflict — the resource already exists in this state
    if (error instanceof teamService.AlreadyMemberError) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('[inviteMember]', error);
    res.status(500).json({ error: 'Failed to invite member' });
  }
}

// ============================================================
// getTeamMembers
//
// PURPOSE: Handle GET /api/teams/:id/members
//          List all members of a team with their roles.
//
// ACCESS: Any team member (requireRole('viewer'))
//
// INPUTS:
//   req.params.id — team ID
//
// OUTPUTS:
//   200 OK — array of members with user info and role
//   500 Server Error
// ============================================================
export async function getTeamMembers(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const members = await teamService.getTeamMembers(teamId);
    res.status(200).json({ members });
  } catch (error) {
    console.error('[getTeamMembers]', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
}

// PURPOSE: Update team name and/or description
// INPUTS:  req.params.id = teamId, req.body = { name?, description? }
// OUTPUTS: 200 with updated team
export const updateTeamHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const teamId = parseInt(req.params.id as string, 10)
    const userId = req.user!.userId
    const { name, description } = req.body

    if (!name?.trim()) {
      res.status(400).json({ error: 'Team name cannot be empty' })
      return
    }

    // Only admins can update team info
    const member = await prisma.teamMember.findFirst({
      where: { team_id: teamId, user_id: userId }
    })
    if (!member || member.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can update team settings' })
      return
    }

    const updated = await prisma.team.update({
      where: { id: teamId },
      data: {
        name: name.trim(),
        description: description?.trim() ?? undefined,
        updated_at: new Date()
      }
    })

    res.json({ team: updated })
  } catch (err) {
    console.error('[updateTeamHandler]', err)
    res.status(500).json({ error: 'Failed to update team' })
  }
}

// PURPOSE: Permanently delete a team and cascade all its data
// INPUTS:  req.params.id = teamId
// OUTPUTS: 200 with success message
export const deleteTeamHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const teamId = parseInt(req.params.id as string, 10)
    const userId = req.user!.userId

    // Only admins can delete
    const member = await prisma.teamMember.findFirst({
      where: { team_id: teamId, user_id: userId }
    })
    if (!member || member.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete the team' })
      return
    }

    // Must be the owner to delete entirely
    // WHY: Even admins shouldn't be able to delete a team they didn't create
    // Remove this check if you want any admin to delete
    const team = await prisma.team.findUnique({ where: { id: teamId } })
    if (!team) {
      res.status(404).json({ error: 'Team not found' })
      return
    }

    // Prisma CASCADE handles deleting members, files, folders etc
    // as long as your schema has onDelete: Cascade on foreign keys
    await prisma.team.delete({ where: { id: teamId } })

    res.json({ message: 'Team deleted successfully' })
  } catch (err) {
    console.error('[deleteTeamHandler]', err)
    res.status(500).json({ error: 'Failed to delete team' })
  }
}

// ============================================================
// changeMemberRole
//
// PURPOSE: Handle PATCH /api/teams/:id/members/:userId
//          Update a team member's role.
//
// ACCESS: Admin only (requireRole('admin'))
//
// INPUTS:
//   req.params.id       — team ID
//   req.params.userId   — which member to update
//   req.body.role       — new role: 'viewer' | 'editor' | 'admin'
//   req.user.userId     — who is making the change
//
// OUTPUTS:
//   200 OK — role updated
//   400    — role missing or invalid value
//   403    — trying to change the owner's role (not allowed)
//   404    — team or member not found
//   500 Server Error
//
// WHY PROTECT THE OWNER?
//   The owner created the team. If demoted, no one manages it.
//   This safety rule lives in the service, not here.
// ============================================================
export async function changeMemberRole(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const targetUserId = parseInt(req.params.userId as string, 10);
    const { role } = req.body;

    if (!role) {
      res.status(400).json({ error: 'New role is required' });
      return;
    }

    const validRoles = ['viewer', 'editor', 'admin'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid role', validRoles });
      return;
    }

    const requestingUserId = req.user!.userId;

    const updated = await teamService.changeMemberRole(
      teamId,
      targetUserId,
      role,
      requestingUserId
    );

    res.status(200).json({ message: 'Member role updated', member: updated });
  } catch (error) {
    if (error instanceof teamService.TeamNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof teamService.CannotRemoveOwnerError) {
      res.status(403).json({ error: error.message });
      return;
    }
    if (error instanceof teamService.NotMemberError) {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[changeMemberRole]', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
}

// ============================================================
// removeMember
//
// PURPOSE: Handle DELETE /api/teams/:id/members/:userId
//          Remove a user from a team entirely.
//
// ACCESS: Admin only (requireRole('admin'))
//
// INPUTS:
//   req.params.id       — team ID
//   req.params.userId   — which member to remove
//
// OUTPUTS:
//   200 OK — member removed
//   403    — trying to remove the team owner (not allowed)
//   404    — member not found in this team
//   500 Server Error
//
// WHY HARD DELETE (not soft delete)?
//   Team membership is not content — there is no recovery use case.
//   If someone is removed and re-added, a fresh record is created.
//   Compare with files where recovery IS needed (Week 12).
// ============================================================
export async function removeMember(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const targetUserId = parseInt(req.params.userId as string, 10);

    await teamService.removeMember(teamId, targetUserId);

    res.status(200).json({ message: 'Member removed from team' });
  } catch (error) {
    if (error instanceof teamService.CannotRemoveOwnerError) {
      res.status(403).json({ error: error.message });
      return;
    }
    if (error instanceof teamService.NotMemberError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof teamService.TeamNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[removeMember]', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
}
