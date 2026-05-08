// PURPOSE: Handle HTTP requests for authentication endpoints
// WHY A CONTROLLER LAYER: Controllers are intentionally thin.
//   They only do 3 things:
//     1. Read data from the request (req.body, req.user)
//     2. Call the service (which has the real logic)
//     3. Send the response back
//   NO business logic here — that lives in auth.service.ts
//   This separation makes both layers easier to test and change.

import { Request, Response } from 'express';
import {
  registerUser,
  loginUser,
  getUserById,
} from '../services/auth.service';
import prisma from '../config/database'
import bcrypt from 'bcrypt'

// ─── Register ─────────────────────────────────────────────────

// ============================================================
// register()
// PURPOSE: Handle POST /api/auth/register
// INPUTS: req.body = { name, email, password }
// OUTPUTS: 201 + { token, user } on success
//          400 if email taken or validation fails
// ============================================================
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    // ── Step 1: Extract fields from request body ─────────────
    const { name, email, password } = req.body;

    // ── Step 2: Basic validation ─────────────────────────────
    // WHY HERE AND NOT IN SERVICE: Input validation belongs at
    //   the HTTP boundary. The service assumes clean input.
    if (!name || !email || !password) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Name, email, and password are all required',
      });
      return;
    }

    // WHY 8 CHARACTERS: Short passwords are easily brute-forced.
    //   8 chars is the widely accepted minimum for security.
    if (password.length < 8) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Password must be at least 8 characters',
      });
      return;
    }

    // Basic email format check
    // WHY REGEX: Catches obvious typos like "alice@" or "notanemail"
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Please provide a valid email address',
      });
      return;
    }

    // ── Step 3: Call the service ─────────────────────────────
    const result = await registerUser({ name, email, password });

    // ── Step 4: Send success response ───────────────────────
    // WHY 201: HTTP 201 = "Created" — a new resource was created
    //   (vs 200 = "OK" which means something already existed)
    // We spread ...result to include requiresTwoFactor, tempToken, and twoFactorSetup
    res.status(201).json({
      message: 'Account created successfully',
      ...result,
    });

  } catch (error: any) {
    // ── Handle known service errors ──────────────────────────
    if (error.message === 'EMAIL_TAKEN') {
      res.status(400).json({
        error: 'Email Already Taken',
        message: 'An account with this email already exists',
      });
      return;
    }

    // Unknown error — log it and return generic message
    // WHY GENERIC: Never expose internal error details to clients
    //   — they could reveal database structure or server info
    console.error('Register error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again.',
    });
  }
};

// ─── Login ────────────────────────────────────────────────────

// ============================================================
// login()
// PURPOSE: Handle POST /api/auth/login
// INPUTS: req.body = { email, password }
// OUTPUTS: 200 + { token, user } on success
//          401 if credentials are wrong
// ============================================================
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    // ── Step 1: Extract fields ───────────────────────────────
    const { email, password } = req.body;

    // ── Step 2: Basic validation ─────────────────────────────
    if (!email || !password) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Email and password are required',
      });
      return;
    }

    // ── Step 3: Call the service ─────────────────────────────
    const result = await loginUser({ email, password });

    // ── Step 4: Send success response ───────────────────────
    // WHY 200: HTTP 200 = "OK" — no new resource was created,
    //   we just verified identity and returned a token
    res.status(200).json({
      message: 'Login successful',
      ...result,
    });
  } catch (error: any) {
    // ── Handle known service errors ──────────────────────────
    if (error.message === 'INVALID_CREDENTIALS') {
      // WHY SAME MESSAGE FOR WRONG EMAIL AND WRONG PASSWORD:
      //   If we said "email not found" vs "wrong password" separately,
      //   attackers could enumerate which emails are registered.
      //   Same message = no information leak.
      res.status(401).json({
        error: 'Invalid Credentials',
        message: 'Email or password is incorrect',
      });
      return;
    }

    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again.',
    });
  }
};

// ─── Get Current User ─────────────────────────────────────────

// ============================================================
// getMe()
// PURPOSE: Handle GET /api/auth/me
// INPUTS: req.user (attached by authenticate middleware)
// OUTPUTS: 200 + user profile on success
//          401 if not authenticated (caught by middleware)
// WHY THIS ENDPOINT EXISTS: The frontend needs to know who is
//   logged in after a page refresh. Instead of storing user
//   data in localStorage (insecure), it stores the token and
//   calls /me on startup to get fresh user data.
// ============================================================
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    // ── Step 1: Get userId from JWT payload ──────────────────
    // req.user was attached by authenticate() middleware
    // If we reached here, the token was already verified
    const userId = req.user!.userId;

    // ── Step 2: Fetch fresh user data from DB ────────────────
    // WHY FETCH FROM DB: The token only stores userId + email.
    //   We fetch fresh data so the response always reflects
    //   the current state (e.g. if name was updated)
    const user = await getUserById(userId);

    // ── Step 3: Send response ────────────────────────────────
    res.status(200).json({ user });

  } catch (error: any) {
    if (error.message === 'USER_NOT_FOUND') {
      // This happens if a user was deleted but their token still exists
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User no longer exists',
      });
      return;
    }

    console.error('GetMe error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again.',
    });
  }
};
// PURPOSE: Update the current user's username/display name
// INPUTS:  req.body.username — new username
// OUTPUTS: Updated user object
// REPLACE your existing updateProfileHandler with this expanded version:

export const updateProfileHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId
    const { username, full_name, job_title } = req.body

    // Validate username if provided
    if (username !== undefined) {
      if (!username.trim()) {
        res.status(400).json({ error: 'Username cannot be empty' })
        return
      }
      // Check not taken by someone else
      const existing = await prisma.user.findFirst({
        where: { username: username.trim(), NOT: { id: userId } }
      })
      if (existing) {
        res.status(409).json({ error: 'Username already taken' })
        return
      }
    }

    // Build update object — only include fields that were sent
    // WHY PARTIAL UPDATE: Don't overwrite full_name if user only changed username
    const updateData: Record<string, unknown> = {}
    if (username !== undefined) updateData.username = username?.trim() || undefined
    if (full_name !== undefined) updateData.full_name = full_name ? full_name.trim() : null
    if (job_title !== undefined) updateData.job_title = job_title ? job_title.trim() : null

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        full_name: true,
        job_title: true,
        avatar_color: true,
        created_at: true
      }
    })

    res.json({ user: updated })
  } catch (err) {
    console.error('[updateProfileHandler]', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
}

// PURPOSE: Change the current user's password
// INPUTS:  req.body.currentPassword, req.body.newPassword
// OUTPUTS: Success message
// WHY REQUIRE CURRENT PASSWORD: Prevents account takeover if someone
//   leaves their session open — attacker can't change password without
//   knowing the current one.
export const changePasswordHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Both current and new password are required' })
      return
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // Verify current password before allowing change
    const isValid = await bcrypt.compare(currentPassword, user.password_hash)
    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' })
      return
    }

    const newHash = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: newHash }
    })

    res.json({ message: 'Password changed successfully' })
  } catch (err) {
    console.error('[changePasswordHandler]', err)
    res.status(500).json({ error: 'Failed to change password' })
  }
}