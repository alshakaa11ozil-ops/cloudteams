// PURPOSE: All authentication business logic lives here
// WHY A SERVICE LAYER: Controllers should be thin (just handle HTTP).
//   The real logic — hashing, checking duplicates, signing tokens —
//   lives here so it can be tested independently of HTTP.

import bcrypt from 'bcrypt';
import prisma from '../config/database';
import { signToken } from '../utils/jwt';

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
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
    createdAt: Date;
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

  // ── Step 3: Create user in database ───────────────────────
  // WHY LOWERCASE EMAIL: Prevents duplicate accounts from
  //   "Alice@email.com" vs "alice@email.com"
  const user = await prisma.user.create({
    data: {
      username: input.name.trim(),
      email: input.email.toLowerCase().trim(),
      password_hash: passwordHash,
    },
  });

  // ── Step 4: Sign JWT token ─────────────────────────────────
  // WHY SIGN IMMEDIATELY: User is considered logged in right after
  //   registering — no need to force them to log in again
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
export const loginUser = async (input: LoginInput): Promise<AuthResult> => {

  // ── Step 1: Find user by email ─────────────────────────────
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase().trim() },
  });

  // ── Step 2: Verify password ────────────────────────────────
  // WHY CHECK BOTH TOGETHER: If we returned "user not found" for
  //   wrong email and "wrong password" separately, attackers could
  //   enumerate valid emails. Same error = no information leak.
  // bcrypt.compare() hashes the input and compares to stored hash
  const passwordValid = user
    ? await bcrypt.compare(input.password, user.password_hash)
    : false;

  if (!user || !passwordValid) {
    throw new Error('INVALID_CREDENTIALS');
  }

  // ── Step 3: Sign JWT token ─────────────────────────────────
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

// ─── Get Current User ─────────────────────────────────────────

// ============================================================
// getUserById()
// PURPOSE: Fetch user profile by ID (used by GET /api/auth/me)
// INPUTS: userId (number) from the JWT payload
// OUTPUTS: user object without password hash
// ============================================================
export const getUserById = async (userId: number) => {

  const user = await prisma.user.findUnique({
    where: { id: userId },
    // SELECT only safe fields — never return password_hash
    select: {
      id: true,
      username: true,
      email: true,
      created_at: true,
    },
  });

  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  return {
    id: user.id,
    name: user.username,
    email: user.email,
    createdAt: user.created_at,
  };
};