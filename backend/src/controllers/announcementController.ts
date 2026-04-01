// ============================================================
// FILE: src/controllers/announcementController.ts
// PURPOSE: HTTP request/response layer for announcements.
//
// THIN CONTROLLER RULE (same as teamController):
//   1. Extract data from req
//   2. Call service
//   3. Map errors to HTTP status codes
//   4. Send response
//
// ALL business logic lives in announcementService.ts.
// This file only speaks HTTP.
// ============================================================

import { Request, Response } from 'express';
import * as announcementService from '../services/announcementService';
import { AppError } from '../utils/teamGuard';

// ============================================================
// CONTROLLER: createAnnouncement
// Route: POST /api/teams/:id/announcements
// Access: Admin or Owner (enforced in service + requireRole('admin') in route)
// ============================================================
export async function createAnnouncement(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const { title, body, isPinned } = req.body;

    // Input validation — simple guards before hitting the service
    if (!title || typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'Announcement title is required' });
      return;
    }
    if (!body || typeof body !== 'string' || body.trim() === '') {
      res.status(400).json({ error: 'Announcement body is required' });
      return;
    }

    const authorId = req.user!.userId;

    const announcement = await announcementService.createAnnouncement(
      teamId,
      authorId,
      title.trim(),
      body.trim(),
      isPinned === true // Default false unless explicitly true
    );

    res.status(201).json({ message: 'Announcement posted', announcement });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[AnnouncementController]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// CONTROLLER: getTeamAnnouncements
// Route: GET /api/teams/:id/announcements
// Access: Any team member (requireRole('viewer'))
// ============================================================
export async function getTeamAnnouncements(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const announcements = await announcementService.getTeamAnnouncements(teamId);

    res.status(200).json({ announcements });
  } catch (error) {
    console.error('[getTeamAnnouncements]', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
}

// ============================================================
// CONTROLLER: getAnnouncementById
// Route: GET /api/teams/:id/announcements/:announcementId
// Access: Any team member (requireRole('viewer'))
// ============================================================
export async function getAnnouncementById(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const announcementId = parseInt(req.params.announcementId as string, 10);

    const announcement = await announcementService.getAnnouncementById(
      announcementId,
      teamId
    );
    res.status(200).json({ announcement });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[AnnouncementController]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
// ============================================================
// CONTROLLER: updateAnnouncement
// Route: PATCH /api/teams/:id/announcements/:announcementId
// Access: Author or Admin (checked inside service)
// ============================================================
export async function updateAnnouncement(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const announcementId = parseInt(req.params.announcementId as string, 10);
    const { title, body, isPinned } = req.body;

    if (title === undefined && body === undefined && isPinned === undefined) {
      res.status(400).json({ error: 'Provide at least one field: title, body, or isPinned' });
      return;
    }

    const requestingUserId = req.user!.userId;  // JWT uses userId

    const updated = await announcementService.updateAnnouncement(
      announcementId,
      teamId,
      requestingUserId,
      { title, body, isPinned }
    );
    res.status(200).json({ message: 'Announcement updated', announcement: updated });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[AnnouncementController]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// CONTROLLER: deleteAnnouncement
// Route: DELETE /api/teams/:id/announcements/:announcementId
// Access: Author or Admin (checked inside service)
// ============================================================

export async function deleteAnnouncement(req: Request, res: Response) {
  try {
    const teamId = parseInt(req.params.id as string, 10);
    const announcementId = parseInt(req.params.announcementId as string, 10);
    const requestingUserId = req.user!.userId;  // JWT uses userId

    await announcementService.deleteAnnouncement(
      announcementId,
      teamId,
      requestingUserId
    );
    res.status(200).json({ message: 'Announcement deleted' });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[AnnouncementController]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}