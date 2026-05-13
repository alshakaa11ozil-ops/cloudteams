// src/api/auth.ts
//
// PURPOSE: All API functions related to authentication.
//          Keeps auth API calls in one place separate from teams.ts

import api from '../api/axios'
import type { AuthResponse } from '../types'

// ── verify2FA ─────────────────────────────────────────────────────────────
//
// PURPOSE: Complete the 2FA challenge after the login step.
// INPUTS:  code — 6-digit TOTP from Google Authenticator
//          tempToken — short-lived JWT saved in sessionStorage by Login.tsx
// OUTPUTS: Full AuthResponse { token, user } on success

export async function verify2FA(
    code: string,
    tempToken: string
): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/2fa/login', {
        code,
        tempToken,
    })
    return response.data
}

// ── setup2FA ───────────────────────────────────────────────────────────────
//
// PURPOSE: Start the 2FA setup process for a logged-in user.
//          Returns a QR code the user scans with their authenticator app.
//
// INPUTS:  none — user is identified by JWT in the request header
// OUTPUTS: qrCode (data URL for <img> tag) + secret (manual entry fallback)
//
// BACKEND ROUTE: POST /api/auth/2fa/setup
// WHY POST NOT GET: This call generates and saves a new secret to the DB.
//   Generating state = POST. GET is for reading, not creating.

export async function setup2FA(): Promise<{ qrCodeDataUrl: string; secret: string }> {
    const res = await api.post<{ qrCodeDataUrl: string; secret: string }>('/auth/2fa/setup')
    return res.data
}

// ── verifyAndEnable2FA ─────────────────────────────────────────────────────
//
// PURPOSE: Confirm the user successfully scanned the QR code by submitting
//          the 6-digit code their app generates. This ACTIVATES 2FA.
//
// INPUTS:
//   secret — the base32 secret returned by setup2FA() above
//             WHY SEND SECRET: The backend needs to verify the code against
//             this specific secret before saving two_factor_confirmed = true
//   code   — 6-digit TOTP from the authenticator app
//
// OUTPUTS: void — success means 2FA is now active on the account
//
// BACKEND ROUTE: POST /api/auth/2fa/verify-setup

export async function verifyAndEnable2FA(
    secret: string,
    code: string
): Promise<void> {
    await api.post('/auth/2fa/verify-setup', { secret, code })
}

// ── disable2FA ─────────────────────────────────────────────────────────────
//
// PURPOSE: Turn off 2FA for a logged-in user.
//          Requires a valid authenticator code as proof the user still
//          controls their authenticator app — prevents accidental lockout.
//
// INPUTS:
//   code — 6-digit TOTP from authenticator app
//          WHY REQUIRE CODE TO DISABLE: If an attacker gets access to a
//          logged-in session, they can't silently disable 2FA without
//          also having the physical device with the authenticator app.
//
// OUTPUTS: void — success means 2FA is now disabled
//
// BACKEND ROUTE: POST /api/auth/2fa/disable

export async function disable2FA(code: string): Promise<void> {
    await api.post('/auth/2fa/disable', { code })
}