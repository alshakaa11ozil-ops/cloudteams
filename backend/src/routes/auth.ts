// src/routes/auth.ts — CORRECT ORDER:

import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { register, login, getMe, updateProfileHandler, changePasswordHandler } from '../controllers/auth.controller'
import { authenticate } from '../middleware/auth.middleware'
import {
  setupTwoFactorHandler,
  verifySetupHandler,
  twoFactorLoginHandler,
  disableTwoFactorHandler
} from '../controllers/twoFactor.controller'
import { logout } from '../services/auth.service'
import { AppError } from '../utils/teamGuard'

const router = Router()

// Rate limiter — defined FIRST, used on specific routes below
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// ── Public routes (no token) ───────────────────────────────────────────────
router.post('/register', authLimiter, register)
router.post('/login', authLimiter, login)
router.post('/2fa/login', twoFactorLoginHandler)

// ── Protected routes (token required) ─────────────────────────────────────
router.get('/me', authenticate, getMe)
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    await logout(req.headers.authorization)
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message })
      return
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Profile & Security ─────────────────────────────────────────────────────
router.patch('/profile', authenticate, updateProfileHandler)
router.patch('/password', authenticate, changePasswordHandler)

// ── 2FA ───────────────────────────────────────────────────────────────────
router.post('/2fa/setup', authenticate, setupTwoFactorHandler)
router.post('/2fa/verify-setup', authenticate, verifySetupHandler)
router.post('/2fa/disable', authenticate, disableTwoFactorHandler)

export default router
