import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { generateDigestHandler } from '../controllers/digest.controller'

const router = Router()

// POST /api/teams/:teamId/digest
// Any authenticated team member can trigger a digest
router.post('/teams/:teamId/digest', authenticate, generateDigestHandler)

export default router
