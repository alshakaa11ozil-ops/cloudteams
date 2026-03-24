// ============================================================
// FILE: src/services/teamService.ts
// PURPOSE: All business logic for team operations.
//          This is the ONLY place that knows the rules about
//          teams: who can join, what roles mean, what's valid.
//
// WHY KEEP LOGIC HERE (not in controllers)?
//   If we need to call "create team" from an API route AND from
//   a scheduled job AND from a test, we call this service from
//   all three places. No code duplication. No logic drift.
//   The controller just translates HTTP → function call → HTTP.
//
// DESIGN PATTERN: Service Layer Pattern
//   Each function represents one business operation.
//   Functions throw typed errors that controllers catch and
//   convert to HTTP status codes.
// ============================================================
import prisma from '../config/database';

// ── Custom Error Types ───────────────────────────────────────
// WHY: Typed errors let controllers map each failure to the
// correct HTTP status code without parsing error messages.

export class TeamNotFoundError extends Error {
  constructor(teamId: number) {
    super(`Team ${teamId} not found`);
    this.name = 'TeamNotFoundError';
  }
}
export class AlreadyMemberError extends Error {
  constructor(email: string) {
    super(`${email} is already a member of this team`);
    this.name = 'AlreadyMemberError';
  }
}
export class UserNotFoundError extends Error {
  constructor(email: string) {
    super(`No user found with email ${email}`);
    this.name = 'UserNotFoundError';
  }
}
export class CannotRemoveOwnerError extends Error {
  constructor() {
    super('The team owner cannot be removed from the team');
    this.name = 'CannotRemoveOwnerError';
  }
}
export class NotMemberError extends Error {
  constructor() {
    super('This user is not a member of this team');
    this.name = 'NotMemberError';
  }
}
// ============================================================
// createTeam
// PURPOSE: Create a team and add creator as admin in one atomic
//          transaction. If either write fails, both are rolled back.
// WHY TRANSACTION: Prevents a team existing with no admin member.
// ============================================================
export async function createTeam(
  name: string,
  description: string | undefined,
  ownerId: number
) {
  return await prisma.$transaction(async (tx) => {
    // Write 1: create the team row
    const team = await tx.team.create({
      data: {
        name,
        description: description ?? null,
        owner_id: ownerId,  // schema field is owner_id (snake_case)
      },
    });
 
    // Write 2: add creator as admin member
    await tx.teamMember.create({
      data: {
        team_id: team.id,   // schema field is team_id
        user_id: ownerId,   // schema field is user_id
        role: 'admin',
      },
    });
 
    return team;
  });
}

// ============================================================
// getTeamById
// PURPOSE: Fetch full team details including all members.
// ============================================================
export async function getTeamById(teamId: number) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        include: {
          // Include the user record for each member
          user: {
            select: { id: true, username: true, email: true },
          },
        },
        orderBy: { created_at: 'asc' },
      },
      _count: {
        select: { files: true },
      },
    },
  });
 
  if (!team) throw new TeamNotFoundError(teamId);
  return team;
}

// ============================================================
// getUserTeams
// PURPOSE: Get all teams a user belongs to, for their dashboard.
// ============================================================
export async function getUserTeams(userId: number) {
  const memberships = await prisma.teamMember.findMany({
    where: { user_id: userId },   // snake_case
    include: {
      team: {
        include: {
          _count: {
            select: { members: true, files: true },
          },
        },
      },
    },
    orderBy: { created_at: 'desc' },  // snake_case
  });
 
  // Return teams with the user's role embedded
  return memberships.map((m) => ({
    ...m.team,
    myRole: m.role,
  }));
}
// ============================================================
// inviteMember
// PURPOSE: Add a user to a team by email.
// EDGE CASES: user not found, already a member.
// ============================================================
export async function inviteMember(
  teamId: number,
  email: string,
  role: 'viewer' | 'editor' | 'admin',
  invitedByUserId: number
) {
  // Step 1: find the user by email
  const userToInvite = await prisma.user.findUnique({
    where: { email },
    select: { id: true, username: true, email: true },
  });
  if (!userToInvite) throw new UserNotFoundError(email);
 
  // Step 2: check not already a member
  const existing = await prisma.teamMember.findFirst({
    where: { team_id: teamId, user_id: userToInvite.id },
  });
  if (existing) throw new AlreadyMemberError(email);
 
  // Step 3: create membership
  const newMember = await prisma.teamMember.create({
    data: {
      team_id: teamId,
      user_id: userToInvite.id,
      role,
    },
    include: {
      user: {
        select: { id: true, username: true, email: true },
      },
    },
  });
 
  return newMember;
}
 
// ============================================================
// getTeamMembers
// PURPOSE: List all members with their user info and role.
// ============================================================
export async function getTeamMembers(teamId: number) {
  return await prisma.teamMember.findMany({
    where: { team_id: teamId },
    include: {
      user: {
        select: { id: true, username: true, email: true },
      },
    },
    orderBy: { created_at: 'asc' },
  });
}

// ============================================================
// changeMemberRole
// PURPOSE: Update a member's role. Owner cannot be demoted.
// ============================================================
export async function changeMemberRole(
  teamId: number,
  targetUserId: number,
  newRole: 'viewer' | 'editor' | 'admin',
  requestingUserId: number
) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { owner_id: true },
  });
  if (!team) throw new TeamNotFoundError(teamId);
 
  // Owner cannot be demoted — safety invariant
  if (targetUserId === team.owner_id) throw new CannotRemoveOwnerError();
 
  const membership = await prisma.teamMember.findFirst({
    where: { team_id: teamId, user_id: targetUserId },
  });
  if (!membership) throw new NotMemberError();
 
  return await prisma.teamMember.update({
    where: { id: membership.id },
    data: { role: newRole },
    include: {
      user: {
        select: { id: true, username: true, email: true },
      },
    },
  });
}
// ============================================================
// removeMember
// PURPOSE: Remove a user from a team. Owner cannot be removed.
// WHY HARD DELETE: Memberships don't need recovery like files do.
// ============================================================
export async function removeMember(teamId: number, targetUserId: number) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { owner_id: true },
  });
  if (!team) throw new TeamNotFoundError(teamId);
 
  if (targetUserId === team.owner_id) throw new CannotRemoveOwnerError();
 
  const membership = await prisma.teamMember.findFirst({
    where: { team_id: teamId, user_id: targetUserId },
  });
  if (!membership) throw new NotMemberError();
 
  await prisma.teamMember.delete({
    where: { id: membership.id },
  });
}