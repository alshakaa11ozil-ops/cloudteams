// =============================================================================
// src/services/twoFactor.service.ts
// PURPOSE: All business logic for TOTP-based two-factor authentication.
//          Handles secret generation, QR code creation, code verification,
//          and enabling/disabling 2FA on a user account.
//
// WHAT IS TOTP?
//   Time-based One-Time Password. Both the server and the user's phone
//   independently compute the same 6-digit code using:
//     1. A shared secret (generated once at setup, stored in the DB)
//     2. The current time (floored to 30-second windows)
//   If both sides produce the same code → the user is verified.
//   The secret is NEVER transmitted again after setup — only codes are.
//
// WHY speakeasy?
//   It implements RFC 6238 (TOTP standard) — the same algorithm used by
//   Google Authenticator, Authy, and every major 2FA app. Battle-tested,
//   widely used, handles the edge cases (clock drift, token windows) for us.
//
// FLOW OVERVIEW:
//   Setup:   generate secret → show QR code → user scans → user confirms 
//            code works → save secret to DB → 2FA active
//   Login:   password verified → has 2FA? → issue tempToken → user submits
//            code → verify → issue real JWT
//   Disable: user submits valid code → set secret to null → 2FA off
// =============================================================================

import speakeasy from "speakeasy";
import QRCode from "qrcode";
import prisma from "../config/database";
import { signToken } from "../utils/jwt";

// ---------------------------------------------------------------------------
// CUSTOM ERROR CLASSES
// ---------------------------------------------------------------------------
export class InvalidTwoFactorCodeError extends Error {
  constructor(message = "Invalid or expired 2FA code") {
    super(message);
    this.name = "InvalidTwoFactorCodeError";
  }
}

export class TwoFactorNotEnabledError extends Error {
  constructor(message = "Two-factor authentication is not enabled") {
    super(message);
    this.name = "TwoFactorNotEnabledError";
  }
}

export class TwoFactorAlreadyEnabledError extends Error {
  constructor(message = "Two-factor authentication is already enabled") {
    super(message);
    this.name = "TwoFactorAlreadyEnabledError";
  }
}

export class UserNotFoundError extends Error {
  constructor(message = "User not found") {
    super(message);
    this.name = "UserNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// WHAT IS A tempToken AND WHY DO WE NEED IT?
// ---------------------------------------------------------------------------
// After a user passes password check but BEFORE they pass the 2FA check,
// we need to identify them without granting full access.
//
// We use a SHORT-LIVED JWT (5 minutes) with a special purpose field:
//   { userId: 5, email: "alice@uni.edu", purpose: "2fa_challenge" }
//
// The /2fa/login endpoint ONLY accepts tokens with purpose: "2fa_challenge".
// The authenticate middleware ONLY accepts tokens WITHOUT that purpose field.
// This means the tempToken cannot be used to access protected routes.
//
// WHY 5 MINUTES?
//   Long enough for the user to open their authenticator app and type the code.
//   Short enough that a stolen tempToken expires before an attacker can use it.
// ---------------------------------------------------------------------------
const TEMP_TOKEN_EXPIRY = "5m"; // 5 minutes

// ===========================================================================
// FUNCTION 1: generateSetupData
// ===========================================================================
// PURPOSE: Generate a new TOTP secret and QR code for a user to scan.
//          Does NOT save the secret to the DB yet — we wait until the user
//          confirms the code works (in verifySetup below).
//
// WHY NOT SAVE IMMEDIATELY?
//   If we saved the secret before the user confirmed it works, and the user
//   made a mistake scanning the QR code, their 2FA would be broken — they'd
//   have a secret saved that doesn't match their app. We only save after
//   successful verification.
//
// INPUTS:
//   userId (number) — the user setting up 2FA
//
// OUTPUTS:
//   Promise<{ secret: string, qrCodeDataUrl: string }>
//     secret       — the base32 secret string (shown as backup code)
//     qrCodeDataUrl — base64 PNG image the frontend renders as <img src=...>
//
// THROWS:
//   UserNotFoundError        — if userId doesn't exist
//   TwoFactorAlreadyEnabledError — if user already has 2FA active
// ===========================================================================
export const generateSetupData = async (
  userId: number
): Promise<{ secret: string; qrCodeDataUrl: string }> => {
  // Fetch user to get their email (used as the account label in the QR code)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, two_factor_secret: true },
  });

  if (!user) throw new UserNotFoundError();

  // Don't let users generate a new secret if 2FA is already enabled.
  // They must disable it first, then re-enable.
  if (user.two_factor_secret) {
    throw new TwoFactorAlreadyEnabledError();
  }

  // speakeasy.generateSecret() creates a cryptographically random secret.
  // name: appears in Google Authenticator as the account label
  //   e.g. "CloudTeams (alice@university.edu)"
  // length: 20 bytes → 32 characters in base32 encoding.
  //   32 chars is the standard length — long enough to be unguessable.
  const secretObject = speakeasy.generateSecret({
    name: `CloudTeams (${user.email})`, // label shown in authenticator app
    length: 20,                          // 20 random bytes
  });

  // secretObject.base32 is the secret in base32 encoding.
  // Base32 uses only uppercase letters A-Z and digits 2-7.
  // WHY BASE32? It avoids ambiguous characters (0/O, 1/l) that cause
  // transcription errors when users manually enter backup codes.
  const secret = secretObject.base32;

  // secretObject.otpauth_url is a standard URI format:
  //   otpauth://totp/CloudTeams%20(alice%40uni.edu)?secret=JBSWY3...&issuer=CloudTeams
  // Google Authenticator and Authy parse this URI from the QR code.
  // QRCode.toDataURL() converts this URI into a base64-encoded PNG image.
  // The frontend renders it as: <img src={qrCodeDataUrl} />
  const qrCodeDataUrl = await QRCode.toDataURL(secretObject.otpauth_url!);

  // Return secret + QR code — NOT saved to DB yet
  return { secret, qrCodeDataUrl };
};

// ===========================================================================
// FUNCTION 2: verifySetupAndEnable
// ===========================================================================
// PURPOSE: Confirm that the user successfully scanned the QR code by
//          verifying their first 6-digit code. Only then save the secret.
//
// INPUTS:
//   userId (number)  — the user completing setup
//   secret (string)  — the base32 secret from generateSetupData
//   code   (string)  — the 6-digit code from the user's authenticator app
//
// OUTPUTS:
//   Promise<void> — resolves silently on success
//
// THROWS:
//   InvalidTwoFactorCodeError — if the code doesn't match the secret
//
// WHY window: 1?
//   TOTP codes change every 30 seconds. If the user's phone clock is
//   slightly off, their code might be from the previous or next 30-second
//   window. window: 1 accepts 1 window before and after the current time
//   (i.e. ±30 seconds of clock drift). This is the standard tolerance.
// ===========================================================================
export const verifySetupAndEnable = async (
  userId: number,
  secret: string,
  code: string
): Promise<void> => {
  // Verify the code against the secret BEFORE saving anything to the DB.
  // speakeasy.totp.verify() independently computes what the code should be
  // right now, and compares it to what the user submitted.
  const isValid = speakeasy.totp.verify({
    secret,          // the base32 secret from the setup step
    encoding: "base32", // tell speakeasy the secret format
    token: code,     // the 6-digit code the user typed
    window: 1,       // accept ±1 time window (±30 seconds) for clock drift
  });

  if (!isValid) {
    // Code didn't match — user probably scanned the wrong QR code or
    // typed incorrectly. Don't save anything.
    throw new InvalidTwoFactorCodeError(
      "Code is invalid. Please scan the QR code again and try once more."
    );
  }

  // Code is valid → save the secret to the database
  // From this moment on, every login for this user requires a 2FA code
  await prisma.user.update({
    where: { id: userId },
    data: { two_factor_secret: secret },
  });
};

// ===========================================================================
// FUNCTION 3: completeTwoFactorLogin
// ===========================================================================
// PURPOSE: The second step of login for users with 2FA enabled.
//          Verifies the tempToken + 6-digit code, then issues the real JWT.
//
// INPUTS:
//   tempToken (string) — the short-lived JWT from the first login step
//   code      (string) — 6-digit code from the user's authenticator app
//
// OUTPUTS:
//   Promise<{ token: string, user: object }> — same shape as normal login
//
// THROWS:
//   InvalidTwoFactorCodeError — bad tempToken OR bad 6-digit code
//   UserNotFoundError         — userId in tempToken doesn't exist
//   TwoFactorNotEnabledError  — user doesn't have 2FA (shouldn't happen)
//
// WHY VERIFY THE tempToken MANUALLY HERE (not via authenticate middleware)?
//   The authenticate middleware is designed for protected API routes.
//   Here we need to:
//     1. Verify the token is valid AND has purpose: "2fa_challenge"
//     2. Extract the userId from it
//   A dedicated check is cleaner than repurposing the middleware.
// ===========================================================================
export const completeTwoFactorLogin = async (
  tempToken: string,
  code: string
): Promise<{ token: string; user: object }> => {
  // Step 1: Decode and validate the tempToken
  // We import verifyToken from jwt utils — it throws if expired or tampered
  const { verifyToken } = await import("../utils/jwt");

  let payload: { userId: number; email: string; purpose?: string };
  try {
    payload = verifyToken(tempToken) as {
      userId: number;
      email: string;
      purpose?: string;
    };
  } catch {
    // Token expired (5 min elapsed) or was tampered with
    throw new InvalidTwoFactorCodeError(
      "Session expired. Please log in again."
    );
  }

  // Step 2: Confirm this token was issued for 2FA challenge specifically.
  // A regular JWT (from a fully authenticated user) has no purpose field.
  // Accepting it here would let authenticated users skip the 2FA code check.
  if (payload.purpose !== "2fa_challenge") {
    throw new InvalidTwoFactorCodeError("Invalid token type.");
  }

  // Step 3: Fetch the user and their stored 2FA secret
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      username: true,
      email: true,
      two_factor_secret: true,
      created_at: true,
    },
  });

  if (!user) throw new UserNotFoundError();
  if (!user.two_factor_secret) throw new TwoFactorNotEnabledError();

  // Step 4: Verify the 6-digit code against the stored secret
  const isValid = speakeasy.totp.verify({
    secret: user.two_factor_secret, // secret stored in DB at setup
    encoding: "base32",
    token: code,
    window: 1, // ±30 seconds clock drift tolerance
  });

  if (!isValid) {
    throw new InvalidTwoFactorCodeError();
  }

  // Step 5: Code is valid — issue the REAL JWT (same shape as normal login)
  // This token has no purpose field — it's a full access token
  const token = signToken({ userId: user.id, email: user.email });

  return {
    token,
    user: {
      id: user.id,
      name: user.username,
      email: user.email,
      createdAt: user.created_at,
    },
  };
};

// ===========================================================================
// FUNCTION 4: disableTwoFactor
// ===========================================================================
// PURPOSE: Turn off 2FA for a user. Requires them to submit a valid code
//          first — this proves they still have access to their authenticator
//          app and aren't being disabled by someone who stole their password.
//
// INPUTS:
//   userId (number) — the authenticated user
//   code   (string) — 6-digit code to confirm they control the app
//
// OUTPUTS:
//   Promise<void>
//
// THROWS:
//   TwoFactorNotEnabledError  — 2FA wasn't on
//   InvalidTwoFactorCodeError — code doesn't match
//
// WHY REQUIRE A CODE TO DISABLE?
//   If disabling only required a password, an attacker who compromises
//   the password could immediately disable 2FA and then log in freely.
//   Requiring the code means they also need the physical phone.
// ===========================================================================
export const disableTwoFactor = async (
  userId: number,
  code: string
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, two_factor_secret: true },
  });

  if (!user) throw new UserNotFoundError();

  // Can't disable what isn't enabled
  if (!user.two_factor_secret) {
    throw new TwoFactorNotEnabledError();
  }

  // Verify the code one final time before wiping the secret
  const isValid = speakeasy.totp.verify({
    secret: user.two_factor_secret,
    encoding: "base32",
    token: code,
    window: 1,
  });

  if (!isValid) {
    throw new InvalidTwoFactorCodeError(
      "Cannot disable 2FA — the code you entered is invalid."
    );
  }

  // Set two_factor_secret to null → 2FA disabled
  // Next login will go straight to JWT without 2FA challenge
  await prisma.user.update({
    where: { id: userId },
    data: { two_factor_secret: null },
  });
};

// ===========================================================================
// HELPER (exported for auth.service.ts): issueTempToken
// ===========================================================================
// PURPOSE: Create the short-lived 5-minute JWT issued after password check
//          when the user has 2FA enabled. Called from auth.service.ts login.
//
// INPUTS:
//   userId (number)
//   email  (string)
//
// OUTPUTS:
//   string — a signed JWT with { userId, email, purpose: "2fa_challenge" }
//            and 5-minute expiry
//
// WHY EXPORT FROM HERE (not from jwt.ts)?
//   The tempToken concept belongs to the 2FA feature. Putting it here keeps
//   all 2FA logic in one file. jwt.ts stays generic — it doesn't know about
//   2FA purposes.
// ===========================================================================
export const issueTempToken = (userId: number, email: string): string => {
  // signToken from jwt.ts accepts an optional expiry as second argument.
  // We pass "5m" to override the default 7-day expiry.
  // The purpose field marks this as a challenge token — not a full access token.
  return signToken(
    { userId, email, purpose: "2fa_challenge" } as any,
    TEMP_TOKEN_EXPIRY
  );
};