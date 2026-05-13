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

    const token = authHeader.substring(7); // strip "Bearer "

    // CHECK 1: Cryptographic validity
    // jwt.verify() throws if: signature is wrong, token expired, or malformed
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as { userId: number; email: string };

    // CHECK 2: Blacklist lookup
    // If this token was explicitly invalidated via logout, reject it
    // even though its signature is still mathematically valid.
    const blacklisted = await prisma.tokenBlacklist.findUnique({
      where: { token }
      // findUnique uses the UNIQUE index on 'token' — this is a fast O(1) lookup,
      // not a full table scan. The index is created automatically by @unique in schema.
    });

    if (blacklisted) {
      // The token was explicitly revoked — treat it as if it's expired
      res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
      return;
    }

    // Token is valid and not blacklisted — attach user info to request
    // This is what allows controllers to use req.user!.userId
    req.user = { userId: decoded.userId, email: decoded.email };

    next(); // Pass control to the next middleware or controller
  } catch (error: any) {
    // jwt.verify() throws JsonWebTokenError for bad signature
    // and TokenExpiredError for expired tokens
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired. Please log in again.' });
      return;
    }
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({ error: 'Invalid token.' });
      return;
    }
    // Unexpected error (e.g. database down)
    console.error('[authenticate]', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};