// ============================================================
// FILE: src/services/announcementService.ts
// PURPOSE: All business logic for team announcements.
//
// RULES THIS SERVICE ENFORCES:
//   1. Only team admins OR the team owner can create announcements
//   2. Only the announcement's author OR a team admin can delete it
//   3. Only admins can pin/unpin announcements
//   4. All team members (including viewers) can READ announcements
//
// WHY THESE RULES?
//   Announcements are a broadcast tool — they carry weight.
//   Letting any editor post team-wide notices would create noise
//   and undermine the admin's authority. This mirrors how real
//   tools work: Slack's #announcements channel, Google Classroom
//   posts, and Notion team updates are all admin-controlled.
//
// DESIGN NOTE:
//   We check ownership/admin status INSIDE the service rather than
//   relying purely on requireRole() middleware. WHY?
//   Because the "can delete" rule is more nuanced:
//     - Admin can delete ANY announcement (team management)
//     - Author can delete THEIR OWN announcement (ownership)
//   This two-condition rule can't be expressed with a single
//   requireRole() call — so the service handles it.
// ============================================================


 
// ============================================================
// HELPER: getUserRoleInTeam
//
// PURPOSE: Reusable internal helper that fetches a user's role
//          in a team. Used by multiple service functions below
//          to check permissions without duplicating DB query code.
//
// INPUTS:
//   userId — the user to check
//   teamId — the team context
//
// OUTPUTS:
//   The user's role string ('viewer' | 'editor' | 'admin')
//   OR null if they are not a member of the team
//
// WHY A HELPER?
//   DRY principle (Don't Repeat Yourself). Both createAnnouncement
//   and deleteAnnouncement need to check the caller's role.
//   Without this helper, we'd write the same Prisma query twice.
// ============================================================


// ============================================================
// FUNCTION: createAnnouncement
//
// PURPOSE: Create a new team-wide announcement.
//          Only admins and the team owner can post.
//
// INPUTS:
//   teamId   — which team the announcement belongs to
//   authorId — the user posting the announcement (from JWT)
//   title    — short headline (e.g., "Meeting Tomorrow at 3PM")
//   body     — full announcement text
//   isPinned — whether to pin this announcement at the top
//
// OUTPUTS:
//   The newly created announcement with author info included
//
// PERMISSION RULE:
//   Caller must be admin or team owner.
//   If not → throws InsufficientPermissionError
// ============================================================

 
// ============================================================
// FUNCTION: getTeamAnnouncements
//
// PURPOSE: Fetch all announcements for a team, ordered so that
//          pinned announcements appear first, then most recent.
//
// INPUTS:
//   teamId — the team whose announcements to fetch
//
// OUTPUTS:
//   Array of announcements with author info.
//   Pinned ones come first, then sorted by newest first.
//
// ACCESS: Any team member (viewer, editor, admin) can read.
//   This is enforced at the route level with requireRole('viewer').
//
// WHY TWO SORT ORDERS?
//   isPinned DESC → pinned=true (1) comes before pinned=false (0)
//   createdAt DESC → within each group, newest first
//   This gives: [pinned newest, pinned older, unpinned newest, ...]
// ============================================================

// ============================================================
// FUNCTION: getAnnouncementById
//
// PURPOSE: Fetch a single announcement by its ID.
//          Used for the detail view and for update/delete
//          operations that need to verify the record exists.
//
// INPUTS:
//   announcementId — the announcement's numeric ID
//   teamId         — used to verify the announcement belongs
//                    to the expected team (prevents ID fishing
//                    across teams)
//
// OUTPUTS:
//   The announcement with author info
//
// WHY CHECK teamId TOO?
//   Without this check, a member of Team B could request
//   GET /api/teams/2/announcements/99 where announcement 99
//   actually belongs to Team 1. The teamId check prevents
//   cross-team data leakage.
// ============================================================

// ============================================================
// FUNCTION: updateAnnouncement
//
// PURPOSE: Edit an existing announcement's title, body, or
//          pinned status.
//
// INPUTS:
//   announcementId — which announcement to update
//   teamId         — team scope (cross-team protection)
//   requestingUserId — who is making the update (from JWT)
//   updates        — partial object: { title?, body?, isPinned? }
//
// OUTPUTS:
//   The updated announcement
//
// PERMISSION RULE:
//   Only the original author OR an admin can edit.
//   WHY? The author should be able to fix typos in their own post.
//   Admins can edit anything for moderation.
// ============================================================

// ============================================================
// FUNCTION: deleteAnnouncement
//
// PURPOSE: Permanently delete an announcement.
//
// INPUTS:
//   announcementId   — which announcement to delete
//   teamId           — team scope
//   requestingUserId — who is deleting (from JWT)
//
// OUTPUTS:
//   void
//
// PERMISSION RULE:
//   The AUTHOR can delete their own announcement.
//   An ADMIN can delete any announcement (moderation).
//
// WHY HARD DELETE (not soft delete)?
//   Announcements are communications, not files.
//   There's no "recover deleted announcement" use case.
//   Soft delete adds complexity (isDeleted filter on every query)
//   with no meaningful benefit here.
//   Compare with files, where recovery IS a use case (Week 14).
// ============================================================
import prisma from '../config/database';

// ── Custom Error Types ───────────────────────────────────────

export class AnnouncementNotFoundError extends Error {
  constructor(id: number) {
    super(`Announcement ${id} not found`);
    this.name = 'AnnouncementNotFoundError';
  }
}

export class InsufficientPermissionError extends Error {
  constructor(action: string) {
    super(`You do not have permission to ${action}`);
    this.name = 'InsufficientPermissionError';
  }
}

export class TeamNotFoundError extends Error {
  constructor(teamId: number) {
    super(`Team ${teamId} not found`);
    this.name = 'TeamNotFoundError';
  }
}

// ── Internal Helper ──────────────────────────────────────────
// PURPOSE: Check if a user has admin role in a team.
// WHY: Admins and owners (who are always admin) can post/delete.
// TeamMember uses snake_case fields: team_id, user_id.
async function isAdmin(userId: number, teamId: number): Promise<boolean> {
  const membership = await prisma.teamMember.findFirst({
    where: {
      team_id: teamId,
      user_id: userId,
      role: 'admin',
    },
    select: { id: true },
  });
  return membership !== null;
}

// ============================================================
// createAnnouncement
// PURPOSE: Post a new team-wide announcement. Admin only.
// WHY admin only: Announcements are broadcast tools — only
// admins should have the authority to address the whole team.
// ============================================================
export async function createAnnouncement(
  teamId: number,
  authorId: number,
  title: string,
  body: string,
  isPinned: boolean = false
) {
  // Verify the team exists
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!team) throw new TeamNotFoundError(teamId);

  // Only admins can post
  const canPost = await isAdmin(authorId, teamId);
  if (!canPost) throw new InsufficientPermissionError('post announcements');

  // Announcement model uses camelCase fields
  return await prisma.announcement.create({
    data: {
      teamId,
      authorId,
      title,
      body,
      isPinned,
    },
    include: {
      author: {
        select: { id: true, username: true, email: true },
      },
    },
  });
}

// ============================================================
// getTeamAnnouncements
// PURPOSE: List all announcements for a team.
//          Pinned announcements appear first, then newest first.
// ACCESS: Any team member can read (enforced at route level).
// ============================================================
export async function getTeamAnnouncements(teamId: number) {
  return await prisma.announcement.findMany({
    where: { teamId },
    include: {
      author: {
        select: { id: true, username: true, email: true },
      },
    },
    orderBy: [
      { isPinned: 'desc' },  // pinned=true comes first
      { createdAt: 'desc' }, // then newest first
    ],
  });
}

// ============================================================
// getAnnouncementById
// PURPOSE: Fetch one announcement by ID, scoped to a team.
// WHY scope to teamId: prevents a member of Team B from reading
// an announcement that belongs to Team A using its ID.
// ============================================================
export async function getAnnouncementById(
  announcementId: number,
  teamId: number
) {
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId,
      teamId, // CRITICAL: scope to this team only
    },
    include: {
      author: {
        select: { id: true, username: true, email: true },
      },
    },
  });

  if (!announcement) throw new AnnouncementNotFoundError(announcementId);
  return announcement;
}

// ============================================================
// updateAnnouncement
// PURPOSE: Edit title, body, or pinned status.
// PERMISSIONS:
//   - Author OR admin can edit title and body
//   - Only admin can change isPinned
// ============================================================
export async function updateAnnouncement(
  announcementId: number,
  teamId: number,
  requestingUserId: number,
  updates: { title?: string; body?: string; isPinned?: boolean }
) {
  const announcement = await getAnnouncementById(announcementId, teamId);

  const isAuthor = announcement.authorId === requestingUserId;
  const userIsAdmin = await isAdmin(requestingUserId, teamId);

  if (!isAuthor && !userIsAdmin) {
    throw new InsufficientPermissionError('edit this announcement');
  }

  // Only admins can pin or unpin
  if (updates.isPinned !== undefined && !userIsAdmin) {
    throw new InsufficientPermissionError('pin or unpin announcements');
  }

  return await prisma.announcement.update({
    where: { id: announcementId },
    data: {
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.body !== undefined && { body: updates.body }),
      ...(updates.isPinned !== undefined && { isPinned: updates.isPinned }),
    },
    include: {
      author: {
        select: { id: true, username: true, email: true },
      },
    },
  });
}

// ============================================================
// deleteAnnouncement
// PURPOSE: Permanently delete an announcement.
// PERMISSIONS: Author OR admin can delete.
// WHY hard delete: Announcements are communications, not files.
// There is no recovery use case — unlike files (Week 14).
// ============================================================
export async function deleteAnnouncement(
  announcementId: number,
  teamId: number,
  requestingUserId: number
) {
  const announcement = await getAnnouncementById(announcementId, teamId);

  const isAuthor = announcement.authorId === requestingUserId;
  const userIsAdmin = await isAdmin(requestingUserId, teamId);

  if (!isAuthor && !userIsAdmin) {
    throw new InsufficientPermissionError('delete this announcement');
  }

  await prisma.announcement.delete({
    where: { id: announcementId },
  });
}