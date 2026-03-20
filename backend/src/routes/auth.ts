// PURPOSE: Wire auth URLs to their controller functions
// WHY A SEPARATE ROUTES FILE: Keeps server.ts clean.
//   Each feature has its own routes file. server.ts just
//   mounts them — it doesn't know what's inside them.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

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

// ─── Protected Routes (token required) ───────────────────────

// GET /api/auth/me
// WHY AUTHENTICATE MIDDLEWARE HERE: This route returns the
//   current user's profile. You must be logged in to see it.
//   authenticate() runs first, verifies token, then getMe() runs.
router.get('/me', authenticate, getMe);

export default router;