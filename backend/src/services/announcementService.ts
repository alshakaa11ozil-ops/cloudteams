// src/services/announcementService.ts

import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity } from '../utils/activityLogger';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';

// ─────────────────────────────────────────────
// WHY WE REMOVED LOCAL ERROR CLASSES:
//   AnnouncementNotFoundError, InsufficientPermissionError,
//   and TeamNotFoundError were all just AppError with different names.
//   We now use AppError from teamGuard.ts everywhere — one class,
//   one place to change, consistent behavior across all services.
//
// WHY WE REMOVED isAdmin() helper:
//   assertTeamMember(userId, teamId, 'admin') does the same thing
//   and is already tested and shared. No need to duplicate it.
// ─────────────────────────────────────────────

// ============================================================
// createAnnouncement
// PURPOSE: Post a new team-wide announcement. Admin only.
// WHY admin only: Announcements are broadcast tools — only
//   admins should have authority to address the whole team.
// INPUTS:  teamId, authorId, title, body, isPinned
// OUTPUTS: The created announcement with author info
// ============================================================
export async function createAnnouncement(
  teamId: number,
  authorId: number,
  title: string,
  body: string,
  isPinned: boolean = false
) {
  // Verify team exists
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });

  if (!team) {
    throw new AppError(`Team ${teamId} not found`, 404);
  }

  // assertTeamMember replaces isAdmin() — throws AppError(403) if
  // user is not a member or is below the required role level
  await assertTeamMember(authorId, teamId, 'admin');

  const announcement = await prisma.announcement.create({
    data: { teamId, authorId, title, body, isPinned },
    include: {
      author: {
        select: { id: true, username: true, email: true },
      },
    },
  });

  void logActivity({
    teamId,
    userId: authorId,
    action: 'announcement_posted',
    targetType: 'team',
    targetId: teamId,
    metadata: { announcementId: announcement.id, announcement_title: announcement.title }
  });

  // Real-time notification via helper
  emitToTeam(teamId, SOCKET_EVENTS.ANNOUNCEMENT_POSTED, {
    announcement: announcement as unknown as Record<string, unknown>,
    postedBy: authorId
  });

  return announcement;
}

// ============================================================
// getTeamAnnouncements
// PURPOSE: List all announcements for a team.
//          Pinned announcements appear first, then newest first.
// ACCESS:  Any team member can read (enforced at route level).
// WHY TWO SORT ORDERS:
//   isPinned DESC → true (1) comes before false (0)
//   createdAt DESC → within each group, newest first
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
      { isPinned: 'desc' },  // pinned first
      { createdAt: 'desc' }, // then newest
    ],
  });
}

// ============================================================
// getAnnouncementById
// PURPOSE: Fetch one announcement by ID, scoped to a team.
// WHY scope to teamId: Prevents a member of Team B from reading
//   an announcement belonging to Team A by guessing its ID.
//   This is called an IDOR (Insecure Direct Object Reference)
//   vulnerability — always scope queries to the user's team.
// ============================================================
export async function getAnnouncementById(
  announcementId: number,
  teamId: number
) {
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId,
      teamId, // CRITICAL — scope to this team only
    },
    include: {
      author: {
        select: { id: true, username: true, email: true },
      },
    },
  });

  if (!announcement) {
    throw new AppError(`Announcement ${announcementId} not found`, 404);
  }

  return announcement;
}

// ============================================================
// updateAnnouncement
// PURPOSE: Edit title, body, or pinned status.
// PERMISSIONS:
//   Author OR admin can edit title and body.
//   Only admin can change isPinned.
// WHY TWO-CONDITION RULE:
//   This can't be expressed with a single requireRole() call.
//   The service handles it directly because the logic depends
//   on WHO the user is relative to the specific announcement.
// ============================================================
export async function updateAnnouncement(
  announcementId: number,
  teamId: number,
  requestingUserId: number,
  updates: { title?: string; body?: string; isPinned?: boolean }
) {
  const announcement = await getAnnouncementById(announcementId, teamId);

  // Get the user's membership to check their role
  const membership = await assertTeamMember(requestingUserId, teamId);

  const isAuthor = announcement.authorId === requestingUserId;
  const isAdminUser = membership.role === 'admin';

  // Author OR admin can edit title/body
  if (!isAuthor && !isAdminUser) {
    throw new AppError('You do not have permission to edit this announcement', 403);
  }

  // Only admin can pin/unpin — not even the author
  if (updates.isPinned !== undefined && !isAdminUser) {
    throw new AppError('You do not have permission to pin or unpin announcements', 403);
  }

  const updated = await prisma.announcement.update({
    where: { id: announcementId },
    data: {
      // Spread each field only if it was actually provided
      // WHY: We don't want to overwrite fields the caller didn't include
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

  if (updates.isPinned !== undefined) {
    void logActivity({
      teamId,
      userId: requestingUserId,
      action: 'announcement_pinned',
      targetType: 'team',
      targetId: teamId,
      metadata: { 
        announcementId: announcementId, 
        isPinned: updates.isPinned,
        announcement_title: announcement.title
      }
    });

    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.ANNOUNCEMENT_PINNED, {
      announcementId: announcementId,
      isPinned: updates.isPinned,
      pinnedBy: requestingUserId
    });
  }

  return updated;
}

// ============================================================
// deleteAnnouncement
// PURPOSE: Permanently delete an announcement.
// PERMISSIONS: Author OR admin can delete.
// WHY HARD DELETE (not soft delete):
//   Announcements are communications, not files.
//   There is no "recover a deleted announcement" use case.
//   Soft delete adds complexity (is_deleted filter on every query)
//   with no meaningful benefit. Compare with files (Week 7),
//   where recovery IS a use case — so files use soft delete.
// ============================================================
export async function deleteAnnouncement(
  announcementId: number,
  teamId: number,
  requestingUserId: number
) {
  const announcement = await getAnnouncementById(announcementId, teamId);

  const membership = await assertTeamMember(requestingUserId, teamId);

  const isAuthor = announcement.authorId === requestingUserId;
  const isAdminUser = membership.role === 'admin';

  if (!isAuthor && !isAdminUser) {
    throw new AppError('You do not have permission to delete this announcement', 403);
  }

  await prisma.announcement.delete({
    where: { id: announcementId },
  });
}
