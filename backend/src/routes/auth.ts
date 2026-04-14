// PURPOSE: Wire auth URLs to their controller functions
// WHY A SEPARATE ROUTES FILE: Keeps server.ts clean.
//   Each feature has its own routes file. server.ts just
//   mounts them — it doesn't know what's inside them.

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import {
  setupTwoFactorHandler,
  verifySetupHandler,
  twoFactorLoginHandler,
  disableTwoFactorHandler
} from "../controllers/twoFactor.controller";
import { logout } from '../services/auth.service';
import { assertTeamMember, AppError } from '../utils/teamGuard';


const router = Router();

// ─── Rate Limiting ────────────────────────────────────────────
// WHY RATE LIMIT AUTH ROUTES ONLY: Login and register are the
//   most attacked endpoints. Brute force attacks try thousands
//   of passwords per minute. This stops that cold.
// WHY NOT ALL ROUTES: Rate limiting every endpoint would hurt
//   normal users. Only auth endpoints need this protection.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 10,                   // max 10 attempts per 15 minutes
  // WHY 10: Generous enough for real users who mistype passwords,
  //   strict enough to make brute force attacks take years
  message: {
    error: 'Too Many Requests',
    message: 'Too many attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,  // Disable old X-RateLimit headers
});

// ─── Public Routes (no token needed) ─────────────────────────

// POST /api/auth/register
// WHY NO AUTH: This is how new users are created —
//   they can't have a token before they have an account
router.post('/register', authLimiter, register);

// POST /api/auth/login
// WHY NO AUTH: User doesn't have a token yet — they're
//   providing credentials to GET a token
router.post('/login', authLimiter, login);
// ── 2FA Setup (authenticated — user must be logged in first) ──────────────
// POST /api/auth/2fa/setup
// Returns QR code + secret. Does NOT enable 2FA yet.
router.post("/2fa/setup", authenticate, setupTwoFactorHandler);

// POST /api/auth/2fa/verify-setup
// User submits the secret + first 6-digit code to confirm scan worked.
// Saves secret to DB and activates 2FA.
router.post("/2fa/verify-setup", authenticate, verifySetupHandler);

// ── 2FA Login (NOT authenticated — user is mid-login) ─────────────────────
// POST /api/auth/2fa/login
// Second step of login. Accepts tempToken + 6-digit code.
// Returns real JWT on success.
// WHY NO authenticate middleware?
//   The user isn't authenticated yet. They only have a tempToken.
//   The service verifies the tempToken internally.
router.post("/2fa/login", twoFactorLoginHandler);

// ── Disable 2FA (authenticated) ───────────────────────────────────────────
// POST /api/auth/2fa/disable
// Requires a valid 6-digit code to confirm the user controls their app.
router.post("/2fa/disable", authenticate, disableTwoFactorHandler);

// POST /api/auth/logout
// authenticate runs FIRST — only a logged-in user can log out.
// This also guarantees req.headers.authorization exists and is valid
// before we even try to blacklist the token.
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    // Pass the raw Authorization header — the service extracts the token
    await logout(req.headers.authorization);

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
// ─── Protected Routes (token required) ───────────────────────

// GET /api/auth/me
// WHY AUTHENTICATE MIDDLEWARE HERE: This route returns the
//   current user's profile. You must be logged in to see it.
//   authenticate() runs first, verifies token, then getMe() runs.
router.get('/me', authenticate, getMe);

export default router;