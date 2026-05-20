// PURPOSE: Protect routes that require a logged-in user
// HOW IT WORKS: Reads the JWT from the Authorization header,
//   verifies it, and attaches the user info to req.user
//   so every protected route knows WHO is making the request
// WHY MIDDLEWARE: We don't want to repeat token verification
//   in every single route handler. Write it once here,
//   apply it to any route with one line.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken, JwtPayload } from '../utils/jwt';
import prisma from '../config/database';
// ─── Extend Express Request type ──────────────────────────────
// WHY: By default, Express's Request type has no 'user' property.
//   We extend it here so TypeScript knows req.user exists
//   after this middleware runs. Without this, TypeScript would
//   give an error every time we write req.user.userId.


// ============================================================
// authenticate()
// PURPOSE: Verify JWT token on every protected request
// INPUTS: Express req, res, next (standard middleware signature)
// OUTPUTS: calls next() if valid, returns 401 if invalid
// WHY 401: HTTP 401 = "Unauthorized" — you need to log in first
//   (vs 403 = "Forbidden" — you're logged in but not allowed)
// ============================================================
// export const authenticate = (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ): void => {

//   // ── Step 1: Get token from Authorization header ────────────
//   // WHY AUTHORIZATION HEADER: Industry standard for bearer tokens.
//   //   Format is always: "Bearer eyJhbGc..."
//   //   The word "Bearer" means "the person holding this token"
//   const authHeader = req.headers.authorization;

//   if (!authHeader || !authHeader.startsWith('Bearer ')) {
//     // No token provided at all — stop here
//     res.status(401).json({
//       error: 'Unauthorized',
//       message: 'No token provided. Include Authorization: Bearer <token>',
//     });
//     return; // WHY RETURN: stops execution so next() is never called
//   }

//   // ── Step 2: Extract the token ──────────────────────────────
//   // "Bearer eyJhbGc..." → split on space → take index [1]
//   const token = authHeader.split(' ')[1];

//   // ── Step 3: Verify the token ───────────────────────────────
//   try {
//     // verifyToken() throws if:
//     //   - token is expired
//     //   - token was tampered with
//     //   - token was signed with a different secret
//     const payload = verifyToken(token);

//     // ── Step 4: Attach user info to the request ──────────────
//     // WHY: Every route handler after this middleware can now
//     //   read req.user.userId to know who made the request.
//     //   No need to decode the token again in each route.
//     req.user = payload;

//     // ── Step 5: Pass control to the next handler ─────────────
//     next();

//   } catch (error) {
//     // Token is invalid or expired
//     res.status(401).json({
//       error: 'Unauthorized',
//       message: 'Token is invalid or expired. Please log in again.',
//     });
//   }
// };
// ===========================================================================
// MIDDLEWARE: authenticate
// ===========================================================================
// PURPOSE: Verifies every protected request has a valid, non-revoked JWT.
//          Runs before every controller that requires login.
//
// TWO CHECKS performed in order:
//   1. Cryptographic validity — jwt.verify() checks the signature + expiry
//   2. Blacklist check — queries token_blacklist to catch logged-out tokens
//
// WHY TWO CHECKS:
//   A token can be cryptographically valid (signature correct, not expired)
//   but still revoked (user logged out). Check 1 catches forgeries and expired
//   tokens. Check 2 catches deliberately invalidated tokens.
// ===========================================================================
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    // Must follow "Bearer <token>" format
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);

    // CHECK 1: Cryptographic validity
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as { userId: number; email: string };

    // CHECK 2: Blacklist lookup
    const blacklisted = await prisma.token_blacklist.findUnique({
      where: { token }

    });

    if (blacklisted) {
      res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
      return;
    }
    req.user = { userId: decoded.userId, email: decoded.email };
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired. Please log in again.' });
      return;
    }
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({ error: 'Invalid token.' });
      return;
    }

    console.error('[authenticate]', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};
