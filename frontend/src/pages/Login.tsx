// src/pages/Login.tsx
//
// PURPOSE: Login form. Collects email + password.
//          Sends to POST /api/auth/login.
//          On success: saves token via AuthContext → navigates to /teams.
//          On 2FA required: saves tempToken to sessionStorage → navigates to /2fa.
//          On failure: shows server error banner.
//
// INPUTS:  None
// OUTPUTS: Login form page

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '../api/axios'
import { useAuth } from '../hooks/useAuth'
import type { AuthResponse, TwoFARequiredResponse } from '../types'

// ─── 1. ZOD SCHEMA ─────────────────────────────────────────────────────────
//
// Defines what a valid login form looks like.
// Zod validates BEFORE the form submits — no wasted backend call
// on obviously invalid data like an empty email field.

const loginSchema = z.object({
    email: z
        .string()
        .min(1, 'Email is required')
        .email('Please enter a valid email address'),

    password: z
        .string()
        .min(1, 'Password is required'),
    // WHY only min(1) and not min(6):
    // On login we are verifying credentials, not creating them.
    // If the password is wrong the backend tells us.
    // Enforcing a length rule here would confuse users with old accounts.
})

// ─── 2. DERIVED TYPE ───────────────────────────────────────────────────────
//
// z.infer extracts the TypeScript type from the Zod schema automatically.
// If we add a field to loginSchema, LoginFormData updates too — no duplication.

type LoginFormData = z.infer<typeof loginSchema>

// ─── 3. UNION RESPONSE TYPE ────────────────────────────────────────────────
//
// POST /api/auth/login can return ONE of two shapes:
//   A) { token, user }                  → normal login complete
//   B) { requires2FA: true, tempToken } → 2FA step required
//
// TypeScript union type covers both. The 401 error case is in the catch block.

type LoginApiResponse = AuthResponse | TwoFARequiredResponse

// ─── 4. THE COMPONENT ──────────────────────────────────────────────────────

export default function Login() {
    const navigate = useNavigate()  // React Router hook for programmatic navigation
    const { login } = useAuth()     // AuthContext login() — saves token + user globally

    // serverError holds messages that come FROM the backend after a failed attempt.
    // Separate from React Hook Form's field-level errors (those are for Zod failures).
    const [serverError, setServerError] = useState<string | null>(null)

    // ── React Hook Form setup ─────────────────────────────────────────────────
    //
    // useForm manages field state, validation, and submission.
    // zodResolver connects our Zod schema — validation runs before onSubmit.
    // The <LoginFormData> generic makes every returned value fully typed.

    const {
        register,     // Connects an <input> to React Hook Form (injects name, ref, onChange)
        handleSubmit, // Wraps onSubmit — runs Zod validation first, calls onSubmit only if valid
        formState: {
            errors,       // Field-level error messages from Zod
            isSubmitting, // True while our async onSubmit is running — used to disable the button
        },
    } = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
    })

    // ── Submit handler ────────────────────────────────────────────────────────
    //
    // PURPOSE: Called by React Hook Form ONLY after Zod validation passes.
    //          Sends login request. Handles both normal and 2FA responses.
    //
    // INPUTS:  data — validated form values typed as LoginFormData
    // WHY ASYNC: We need to await the API call before deciding what to do next.

    const onSubmit = async (data: LoginFormData) => {
        // Clear any previous server error from a failed attempt
        setServerError(null)

        try {
            // POST /api/auth/login
            // The axios interceptor in axios.ts automatically adds Content-Type: application/json.
            // We type the response as LoginApiResponse — a union of the two possible shapes.
            const response = await api.post<LoginApiResponse>('/auth/login', {
                email: data.email,
                password: data.password,
            })

            const responseData = response.data

            // ── Branch A: 2FA required ──────────────────────────────────────────
            //
            // We check for requires2FA BEFORE assuming it's a full AuthResponse.
            // WHY 'requires2FA' in responseData:
            //   This is a runtime property existence check — safer than responseData.requires2FA === true
            //   because TypeScript's union narrowing doesn't work on runtime values automatically.
            if ('requiresTwoFactor' in responseData && responseData.requiresTwoFactor) {
                // Save the tempToken to sessionStorage.
                sessionStorage.setItem('cloudteams_temp_token', (responseData as any).tempToken)

                // Check if we also got setup data (means 2FA was never confirmed)
                if ((responseData as any).twoFactorSetup) {
                    sessionStorage.setItem(
                        'cloudteams_2fa_setup',
                        JSON.stringify((responseData as any).twoFactorSetup)
                    )
                    navigate('/2fa/setup')
                    return
                }

                // Navigate to the normal 2FA challenge page
                navigate('/2fa')
                return
            }

            // ── Branch B: Normal login (no 2FA) ────────────────────────────────
            //
            // We handled TwoFARequiredResponse above, so TypeScript knows
            // responseData must be AuthResponse here.
            // We still cast explicitly for clarity.

            const authData = responseData as AuthResponse

            // login() from AuthContext:
            //   1. Saves token to localStorage (persists across page refreshes)
            //   2. Saves user to localStorage
            //   3. Updates React state so every component sees the logged-in user
            login(authData.token, authData.user)

            // Navigate to teams. replace: true so the back button
            // doesn't return to the login page after a successful login.
            navigate('/teams', { replace: true })

        } catch (err: unknown) {
            // Axios throws on 4xx/5xx responses.
            // We check for err.response (exists on HTTP errors) vs network errors (no response).

            if (
                err &&
                typeof err === 'object' &&
                'response' in err &&
                err.response &&
                typeof err.response === 'object' &&
                'data' in err.response
            ) {
                const errData = err.response.data as { error?: string }
                const raw = errData.error ?? ''

                if (raw.toLowerCase().includes('invalid')) {
                    // Backend returned "Invalid credentials" or similar.
                    // WHY GENERIC MESSAGE: Saying "wrong password" confirms the email exists.
                    // Saying "invalid email or password" reveals nothing to an attacker.
                    // This is called error message neutrality — standard security practice.
                    setServerError('Invalid email or password.')
                } else if (raw.toLowerCase().includes('many')) {
                    // Rate limiter fired — our backend limits to 10 attempts per 15 minutes
                    setServerError('Too many login attempts. Please wait a few minutes.')
                } else {
                    // Any other backend error — show it as-is
                    setServerError(raw || 'Login failed. Please try again.')
                }
            } else {
                // No response at all — backend is unreachable (server down, no internet)
                setServerError('Cannot reach the server. Check your connection.')
            }
        }
    }

    // ─── 5. RENDER ─────────────────────────────────────────────────────────

    return (
        // Full-height centered layout
        // min-h-screen: at least full viewport height
        // bg-gray-50: light grey background — easier on eyes than pure white
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

                {/* ── Header ─────────────────────────────────────────────────────── */}
                <div className="mb-8">
                    <h1 className="text-2xl font-semibold text-gray-900">
                        Welcome back
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Don't have an account?{' '}
                        {/* Link stays inside the SPA — no full page reload unlike <a href> */}
                        <Link to="/register" className="text-blue-600 hover:underline font-medium">
                            Create one
                        </Link>
                    </p>
                </div>

                {/* ── Server error banner ─────────────────────────────────────────── */}
                {/* Only rendered when serverError is not null */}
                {serverError && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
                        <p className="text-sm text-red-700">{serverError}</p>
                    </div>
                )}

                {/* ── Form ───────────────────────────────────────────────────────── */}
                {/* handleSubmit runs Zod validation, then calls onSubmit if valid */}
                {/* noValidate disables the browser's built-in HTML5 validation popups */}
                {/* — we use Zod instead, which gives us full control over error messages */}
                <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">

                    {/* ── Email field ─────────────────────────────────────────────── */}
                    <div>
                        <label
                            htmlFor="email"
                            className="block text-sm font-medium text-gray-700 mb-1"
                        >
                            Email address
                        </label>
                        <input
                            id="email"
                            type="email"
                            // register() connects this input to React Hook Form.
                            // It injects: name, ref, onChange, onBlur
                            // The string 'email' must match a key in LoginFormData
                            {...register('email')}
                            placeholder="alice@university.edu"
                            autoComplete="email"
                            // autoFocus: cursor lands here when the page loads.
                            // WHY: The user's first action on a login page is always
                            // to type their email — save them one click.
                            autoFocus
                            className={`
                w-full px-3 py-2 rounded-lg border text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                transition-colors
                ${errors.email
                                    ? 'border-red-400 bg-red-50'   // red border when Zod error
                                    : 'border-gray-300 bg-white'    // normal state
                                }
              `}
                        />
                        {/* Show Zod validation error if this field failed */}
                        {errors.email && (
                            <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                        )}
                    </div>

                    {/* ── Password field ──────────────────────────────────────────── */}
                    <div>
                        {/* Two-item row: label on left, hint text on right */}
                        <div className="flex items-center justify-between mb-1">
                            <label
                                htmlFor="password"
                                className="block text-sm font-medium text-gray-700"
                            >
                                Password
                            </label>
                            {/* No forgot password flow in this project — honest placeholder */}
                            <span className="text-xs text-gray-400">
                                Forgot password? Contact your admin
                            </span>
                        </div>
                        <input
                            id="password"
                            type="password"
                            {...register('password')}
                            placeholder="Your password"
                            // current-password tells the browser this is a login form.
                            // Allows password managers to auto-fill correctly.
                            autoComplete="current-password"
                            className={`
                w-full px-3 py-2 rounded-lg border text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                transition-colors
                ${errors.password
                                    ? 'border-red-400 bg-red-50'
                                    : 'border-gray-300 bg-white'
                                }
              `}
                        />
                        {errors.password && (
                            <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
                        )}
                    </div>

                    {/* ── Submit button ───────────────────────────────────────────── */}
                    <button
                        type="submit"
                        // Disabled while the API call is in flight.
                        // Prevents double submission if user clicks twice.
                        disabled={isSubmitting}
                        className="
              w-full py-2.5 px-4 rounded-lg text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-700
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
                    >
                        {/* Show different label while request is in flight */}
                        {isSubmitting ? 'Signing in...' : 'Sign in'}
                    </button>

                </form>
            </div>
        </div>
    )
}