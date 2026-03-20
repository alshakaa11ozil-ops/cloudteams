// PURPOSE: Protect routes that require a logged-in user
// HOW IT WORKS: Reads the JWT from the Authorization header,
//   verifies it, and attaches the user info to req.user
//   so every protected route knows WHO is making the request
// WHY MIDDLEWARE: We don't want to repeat token verification
//   in every single route handler. Write it once here,
//   apply it to any route with one line.

import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';

// ─── Extend Express Request type ──────────────────────────────
// WHY: By default, Express's Request type has no 'user' property.
//   We extend it here so TypeScript knows req.user exists
//   after this middleware runs. Without this, TypeScript would
//   give an error every time we write req.user.userId.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload; // { userId: number, email: string }
    }
  }
}

// ============================================================
// authenticate()
// PURPOSE: Verify JWT token on every protected request
// INPUTS: Express req, res, next (standard middleware signature)
// OUTPUTS: calls next() if valid, returns 401 if invalid
// WHY 401: HTTP 401 = "Unauthorized" — you need to log in first
//   (vs 403 = "Forbidden" — you're logged in but not allowed)
// ============================================================
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {

  // ── Step 1: Get token from Authorization header ────────────
  // WHY AUTHORIZATION HEADER: Industry standard for bearer tokens.
  //   Format is always: "Bearer eyJhbGc..."
  //   The word "Bearer" means "the person holding this token"
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token provided at all — stop here
    res.status(401).json({
      error: 'Unauthorized',
      message: 'No token provided. Include Authorization: Bearer <token>',
    });
    return; // WHY RETURN: stops execution so next() is never called
  }

  // ── Step 2: Extract the token ──────────────────────────────
  // "Bearer eyJhbGc..." → split on space → take index [1]
  const token = authHeader.split(' ')[1];

  // ── Step 3: Verify the token ───────────────────────────────
  try {
    // verifyToken() throws if:
    //   - token is expired
    //   - token was tampered with
    //   - token was signed with a different secret
    const payload = verifyToken(token);

    // ── Step 4: Attach user info to the request ──────────────
    // WHY: Every route handler after this middleware can now
    //   read req.user.userId to know who made the request.
    //   No need to decode the token again in each route.
    req.user = payload;

    // ── Step 5: Pass control to the next handler ─────────────
    next();

  } catch (error) {
    // Token is invalid or expired
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Token is invalid or expired. Please log in again.',
    });
  }
};