// src/api/auth.ts
//
// PURPOSE: All API functions related to authentication.
//          Keeps auth API calls in one place separate from teams.ts

import api from '@/api/axios'
import type { AuthResponse } from '@/types'

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