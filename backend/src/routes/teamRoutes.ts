import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';;
import { requireRole } from '../middleware/requireRole';
import * as teamController from '../controllers/teamController';
import announcementRoutes from './announcementRoutes';

const router = Router();

router.post('/', authenticate, teamController.createTeam);
router.get('/', authenticate, teamController.getUserTeams);
router.get('/:id', authenticate, requireRole('viewer'), teamController.getTeamById);
router.post('/:id/invite', authenticate, requireRole('admin'), teamController.inviteMember);
router.get('/:id/members', authenticate, requireRole('viewer'), teamController.getTeamMembers);
router.patch('/:id/members/:userId', authenticate, requireRole('admin'), teamController.changeMemberRole);
router.delete('/:id/members/:userId', authenticate, requireRole('admin'), teamController.removeMember);
router.use('/:id/announcements', announcementRoutes);

export default router;