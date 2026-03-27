// PURPOSE: All JWT operations in one place — sign and verify tokens
// WHY CENTRALIZE: If we ever change the secret or algorithm, we
//   change it here once, not in 10 different files.

// WHAT IS A JWT?
// A JWT (JSON Web Token) is like a signed passport.
// It has 3 parts separated by dots: header.payload.signature
// Example: eyJhbG.eyJ1c2VyS.SflKxw
// - Header: algorithm used (HS256)
// - Payload: data we stored (userId, email)
// - Signature: proof it wasn't tampered with
// The server signs it with a secret. Anyone can READ the payload
// but CANNOT fake the signature without the secret.

import jwt from 'jsonwebtoken';

// The secret key used to sign tokens
// WHY ENV: Never hardcode secrets — they'd be visible on GitHub
const JWT_SECRET = process.env.JWT_SECRET as string;

// How long until the token expires
// WHY 7 DAYS: Long enough for convenience, short enough for security
// After expiry, the user must log in again
const JWT_EXPIRES_IN = '7d';

// The shape of data we store inside each token
export interface JwtPayload {
  userId: number;   // Who this token belongs to
  email: string;    // Their email (for convenience)
}

// ============================================================
// signToken()
// PURPOSE: Create a signed JWT for a user after login/register
// INPUT: userId and email
// OUTPUT: signed JWT string e.g. "eyJhbG..."
// WHY THIS APPROACH: Signing with a secret means only our server
//   can create valid tokens. Any fake token will fail verification.
// ============================================================
export const signToken = (payload: JwtPayload | any, expiresIn: string = JWT_EXPIRES_IN): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as any });
};

// ============================================================
// verifyToken()
// PURPOSE: Verify a JWT from a request and return its payload
// INPUT: token string from Authorization header
// OUTPUT: the decoded payload (userId, email) or throws error
// WHY: If token is expired, tampered with, or fake —
//   jwt.verify() throws automatically. We catch it in middleware.
// ============================================================
export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
};