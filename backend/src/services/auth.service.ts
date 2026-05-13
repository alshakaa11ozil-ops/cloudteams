// PURPOSE: All authentication business logic lives here
// WHY A SERVICE LAYER: Controllers should be thin (just handle HTTP).
//   The real logic — hashing, checking duplicates, signing tokens —
//   lives here so it can be tested independently of HTTP.

import bcrypt from 'bcrypt';
import prisma from '../config/database';
import { signToken } from '../utils/jwt';
import { issueTempToken } from './twoFactor.service';
import jwt from 'jsonwebtoken';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import * as speakeasy from 'speakeasy'
import * as QRCode from 'qrcode'
// ─── Types ────────────────────────────────────────────────────

// What the register endpoint expects from the request body
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

// What the login endpoint expects from the request body
export interface LoginInput {
  email: string;
  password: string;
}

// What we return to the client after successful auth
// WHY OMIT PASSWORD: Never send the password hash to the client
export interface AuthResult {
  token?: string;
  user?: {
    id: number;
    name: string;
    username: string;
    email: string;
    full_name?: string | null;
    job_title?: string | null;
    avatar_color?: string | null;
    createdAt: Date;
  };
  requiresTwoFactor?: boolean;
  tempToken?: string;
  // NEW: Added to allow returning 2FA setup data during registration OR login recovery
  twoFactorSetup?: {
    qrCode: string;
    secret: string;
  };
}

// ─── Register ─────────────────────────────────────────────────

// ============================================================
// registerUser()
// PURPOSE: Create a new user account
// INPUTS: name, email, password (plain text)
// OUTPUTS: JWT token + user object (no password)
// WHY THIS APPROACH:
//   1. Check duplicate email FIRST — fail fast before hashing
//   2. Hash password with bcrypt — one-way, irreversible
//   3. Store hashed password — never the plain text
//   4. Return token immediately — user is logged in after register
// ============================================================
export const registerUser = async (input: RegisterInput): Promise<AuthResult> => {

  // ── Step 1: Check if email already exists ─────────────────
  // WHY: If we skip this, Prisma throws a cryptic unique constraint
  //   error. We catch it early and return a clear message instead.
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase().trim() },
  });

  if (existingUser) {
    // Throw a plain Error with a message the controller can forward
    throw new Error('EMAIL_TAKEN');
  }

  // ── Step 2: Hash the password ──────────────────────────────
  // WHAT IS BCRYPT: bcrypt is a one-way hashing algorithm.
  //   "one-way" means you can never reverse it back to the original.
  //   You can only verify by hashing again and comparing.
  // WHAT IS saltRounds: bcrypt runs the hashing algorithm 2^10 = 1024
  //   times. This makes brute force attacks very slow.
  //   10 = secure enough + fast enough (~100ms on modern hardware)
  //   Higher = more secure but slower (14 = ~1 second per hash)
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(input.password, saltRounds);


  // Generate 2FA secret at registration — every account has 2FA from day one
  const twoFactorSecret = speakeasy.generateSecret({
    name: `CloudTeams (${input.email})`,  // shown in Google Authenticator
    length: 20,
  })
  // ── Step 3: Create user in database ───────────────────────
  // WHY LOWERCASE EMAIL: Prevents duplicate accounts from
  //   "Alice@email.com" vs "alice@email.com"
  const user = await prisma.user.create({
    data: {
      username: input.name.trim(),
      email: input.email.toLowerCase().trim(),
      password_hash: passwordHash,
      two_factor_secret: twoFactorSecret.base32,
      two_factor_confirmed: false, // Mandatory setup pending
    },
  })

  // ── Step 4: Sign temp token for 2FA setup ─────────────────
  // WHY TEMP TOKEN: We don't want to grant full access until 2FA is verified.
  const tempToken = issueTempToken(user.id, user.email);

  // Generate QR code as a data URL the frontend can show in an <img> tag
  const qrCodeUrl = await QRCode.toDataURL(twoFactorSecret.otpauth_url ?? '')

  return {
    requiresTwoFactor: true,
    tempToken,
    user: {
      id: user.id,
      name: user.username,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      job_title: user.job_title,
      avatar_color: user.avatar_color,
      createdAt: user.created_at,
    },
    // Return QR code and secret so frontend can show setup screen
    twoFactorSetup: {
      qrCode: qrCodeUrl,
      secret: twoFactorSecret.base32,
    },
  }
}
// ─── Login ────────────────────────────────────────────────────

// ============================================================
// loginUser()
// PURPOSE: Verify credentials and return a JWT token
// INPUTS: email, password (plain text)
// OUTPUTS: JWT token + user object (no password)
// WHY THIS APPROACH:
//   1. Find user by email
//   2. Compare plain password against stored hash with bcrypt
//   3. Return SAME error for wrong email OR wrong password
//      (WHY SAME ERROR: tells attackers nothing about which is wrong)
// ============================================================
// =============================================================================
// REPLACE YOUR EXISTING loginUser FUNCTION IN src/services/auth.service.ts
// WITH THIS. Everything else in auth.service.ts stays exactly the same.
// =============================================================================

// ADD this import at the top of auth.service.ts alongside your other imports:
// import { issueTempToken } from "./twoFactor.service";

// ---------------------------------------------------------------------------
// UPDATED loginUser — now handles 2FA check
// ---------------------------------------------------------------------------
// WHAT CHANGED:
//   After password verification, we now check if the user has 2FA enabled.
//   If yes → return a tempToken + requiresTwoFactor: true (no real JWT yet)
//   If no  → return the real JWT as before (existing behaviour unchanged)
//
// The AuthResult type needs one addition — add this to your AuthResult type:
//   requiresTwoFactor?: boolean
//   tempToken?: string
// ---------------------------------------------------------------------------

export const loginUser = async (input: LoginInput): Promise<AuthResult> => {

  // ── Step 1: Find user by email ─────────────────────────────
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase().trim() },
  });

  // ── Step 2: Verify password ────────────────────────────────
  // WHY CHECK BOTH TOGETHER: Prevents email enumeration attacks.
  // Same error for "user not found" and "wrong password".
  const passwordValid = user
    ? await bcrypt.compare(input.password, user.password_hash)
    : false;

  if (!user || !passwordValid) {
    throw new Error('INVALID_CREDENTIALS');
  }

  // ── Step 3: Check if 2FA is enabled ───────────────────────
  // two_factor_secret is null if 2FA is disabled (the default).
  // If it's set, the user must complete the 2FA challenge before
  // receiving a real JWT.
  if (user.two_factor_secret) {
    // Issue a SHORT-LIVED tempToken (5 minutes).
    // This is NOT a full access token — it can only be used at /2fa/login.
    // The purpose: "2fa_challenge" field prevents it being used elsewhere.
    const tempToken = issueTempToken(user.id, user.email);

    // If 2FA is not confirmed yet (e.g. they abandoned registration),
    // force them back to the setup page by including setup data.
    if (!user.two_factor_confirmed) {
      const qrCodeUrl = await QRCode.toDataURL(
        `otpauth://totp/CloudTeams (${user.email})?secret=${user.two_factor_secret}&issuer=CloudTeams`
      );

      return {
        requiresTwoFactor: true,
        tempToken,
        twoFactorSetup: {
          qrCode: qrCodeUrl,
          secret: user.two_factor_secret,
        },
      } as unknown as AuthResult;
    }

    // Normal confirmed 2FA challenge
    return {
      requiresTwoFactor: true,
      tempToken,
    } as unknown as AuthResult;
  }

  // ── Step 4: No 2FA — issue real JWT immediately (existing flow) ──
  const token = signToken({ userId: user.id, email: user.email });

  // Update last_login timestamp
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login: new Date() }
  });

  const fullUser = await getUserById(user.id)

  return {
    token,
    user: fullUser,
  };
};

// ─── Get Current User ─────────────────────────────────────────

// ============================================================
// getUserById()
// PURPOSE: Fetch user profile by ID (used by GET /api/auth/me)
// INPUTS: userId (number) from the JWT payload
// OUTPUTS: user object without password hash
// ============================================================
// In auth.service.ts — find getUserById and update the select:

export async function getUserById(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      full_name: true,
      job_title: true,
      avatar_color: true,
      created_at: true,
      // WHY INCLUDE THIS: Frontend needs to know if 2FA is active
      // to show the correct UI state in UserSettings.
      // We return a boolean — NEVER the secret itself.
      two_factor_confirmed: true,
    }
  })

  if (!user) throw new Error('USER_NOT_FOUND')

  return {
    ...user,
    name: user.username,
    createdAt: user.created_at,
    twoFactorEnabled: user.two_factor_confirmed ?? false,

  }
}


// ===========================================================================
// FUNCTION: logout
// ===========================================================================
// PURPOSE: Invalidates a JWT token by inserting it into the blacklist table.
//          Even though the token remains cryptographically valid, the
//          authenticate middleware will reject it on every future request.
//
// INPUTS:  authHeader — the raw "Authorization" header value (e.g. "Bearer eyJ...")
// OUTPUTS: void — throws AppError if header is malformed
//
// WHY THIS APPROACH:
//   JWT is stateless by design. The only way to revoke a specific token before
//   its expiry is to maintain a server-side blacklist and check it on every
//   request. We store only the token + its expiry so the cron job can clean
//   up rows that are no longer needed (expired tokens are harmless).
// ===========================================================================
export async function logout(authHeader: string | undefined): Promise<void> {
  // Guard: header must exist and follow "Bearer <token>" format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('No token provided', 400);
  }

  // Extract just the token string after "Bearer "
  const token = authHeader.substring(7); // "Bearer " is 7 characters

  // jwt.decode() reads the payload WITHOUT verifying the signature.
  // We don't need to verify here — authenticate middleware already did that.
  // We only need the 'exp' claim to know when this token naturally expires.
  const decoded = jwt.decode(token) as { exp?: number } | null;

  if (!decoded || !decoded.exp) {
    throw new AppError('Invalid token format', 400);
  }

  // JWT 'exp' is a Unix timestamp in SECONDS.
  // JavaScript Date() expects MILLISECONDS — multiply by 1000.
  const expiresAt = new Date(decoded.exp * 1000);

  // Insert into blacklist. If the token is already there (user clicked
  // logout twice), the UNIQUE constraint fires — we catch and ignore it
  // because the end result is the same: the token is blacklisted.
  try {
    await prisma.tokenBlacklist.create({
      data: {
        token,
        expires_at: expiresAt
        // created_at is automatic via @default(now())
      }
    });
  } catch (error: any) {
    // Prisma error code P2002 = unique constraint violation
    // This means the token was already blacklisted — that's fine, ignore it
    if (error.code !== 'P2002') {
      throw error; // Re-throw anything that isn't a duplicate
    }
  }
}