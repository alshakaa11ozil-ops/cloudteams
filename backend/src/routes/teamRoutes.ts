import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';;
import { requireRole } from '../middleware/requireRole';
import * as teamController from '../controllers/teamController';
import announcementRoutes from './announcementRoutes';
import { getTeamFoldersHandler } from '../controllers/folderController';
import activityRouter from './activityRoutes';
import analyticsRouter from './analyticsRoutes';
// Add this import at the top of teamRoutes.ts//
import {
    getInviteCodeHandler,
    regenerateInviteCodeHandler,
    joinTeamHandler,
} from '../controllers/inviteCode.controller'
import versionRouter from './versionRoutes';
import { summarizeFileHandler } from '../controllers/aiSummary.controller'
import { generateDigestHandler } from '../controllers/digest.controller';
import { updateTeamHandler, deleteTeamHandler } from '../controllers/teamController'

const router = Router();
// Add import at the top

// Add these routes BEFORE export default router
// Join via code — any authenticated user
router.post('/join', authenticate, joinTeamHandler)

// Invite code management — admin only (enforced in service)
router.get('/:id/invite-code', authenticate, getInviteCodeHandler)
router.post('/:id/invite-code/regenerate', authenticate, regenerateInviteCodeHandler)
router.post('/', authenticate, teamController.createTeam);
router.get('/', authenticate, teamController.getUserTeams);
router.get('/:id', authenticate, requireRole('viewer'), teamController.getTeamById);
router.post('/:id/invite', authenticate, requireRole('admin'), teamController.inviteMember);
router.get('/:id/members', authenticate, requireRole('viewer'), teamController.getTeamMembers);
router.patch('/:id/members/:userId', authenticate, requireRole('admin'), teamController.changeMemberRole);
router.delete('/:id/members/:userId', authenticate, requireRole('admin'), teamController.removeMember);
router.use('/:id/announcements', announcementRoutes);
router.get('/:id/folders', authenticate, getTeamFoldersHandler);// Add this route alongside your existing team routes//
router.use('/:id/activity', activityRouter);
// Analytics dashboard: GET /api/teams/:id/analytics
router.use('/:id/analytics', analyticsRouter);

// Add this line before export default router:
// Mounts version routes at /api/teams/:teamId/files/:fileId/versions
// WHY use here not in fileRoutes: version routes are scoped to a team context
// (assertTeamMember needs teamId), so they belong under the /teams namespace
router.use('/', versionRouter);
router.patch('/:id', authenticate, updateTeamHandler)
router.delete('/:id', authenticate, deleteTeamHandler)

// AI Digest route
router.post('/:id/digest', authenticate, requireRole('viewer'), generateDigestHandler);

// AI Summary route — Week 14
router.post('/:id/files/:fileId/summarize', authenticate, requireRole('viewer'), summarizeFileHandler);

export default router;
