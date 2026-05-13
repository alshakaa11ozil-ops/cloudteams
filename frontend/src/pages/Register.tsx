// src/pages/Register.tsx
//
// PURPOSE: Registration form. Collects username, email, password.
//          Validates with Zod before sending to backend.
//          On success: logs user in automatically + navigates to /teams.
//
// INPUTS:  None (reads nothing from props — gets navigate from React Router)
// OUTPUTS: A registration form page

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/api/axios'

// ─── 1. ZOD SCHEMA ─────────────────────────────────────────────────────────
//
// PURPOSE: Defines exactly what a valid registration form looks like.
//          Zod checks this BEFORE the form submits — no backend call wasted
//          on obviously invalid data.
//
// WHY ZOD OVER MANUAL VALIDATION:
//   Manual: if (!email.includes('@')) setError('email', 'Invalid email')
//   Zod:    email: z.string().email('Invalid email')
//   Zod is declarative, composable, and automatically type-safe.

const registerSchema = z.object({
    name: z
        .string()
        .min(2, 'name must be at least 2 characters')
        .max(30, 'name must be under 30 characters')
        // Only letters, numbers, underscores — no spaces or special chars
        // WHY: Your backend stores username as a display name in activity logs
        .regex(/^[a-zA-Z0-9_]+$/, 'name can only contain letters, numbers, and underscores'),

    email: z
        .string()
        .min(1, 'Email is required')
        // z.string().email() uses a proper RFC email regex — not just "has @"
        .email('Please enter a valid email address'),

    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .max(100, 'Password is too long'),
    // WHY max 100: bcrypt silently truncates passwords over 72 bytes.
    // 100 chars is a safe, generous upper limit that prevents surprises.
})

// ─── 2. DERIVE THE TYPESCRIPT TYPE FROM THE SCHEMA ─────────────────────────
//
// z.infer<> extracts the TypeScript type from a Zod schema.
// This means RegisterFormData is ALWAYS in sync with registerSchema.
// If we add a field to the schema, the type updates automatically.
// No duplicated type definitions.

type RegisterFormData = z.infer<typeof registerSchema>
// Equivalent to:
// type RegisterFormData = { username: string; email: string; password: string }

// ─── 3. THE COMPONENT ──────────────────────────────────────────────────────

export default function Register() {
    const navigate = useNavigate()   // React Router hook for programmatic navigation

    // serverError holds errors that come FROM the backend (e.g. "Email taken").
    // These are different from form validation errors, which React Hook Form manages.
    // WHY SEPARATE STATE: React Hook Form manages field-level errors (username, email,
    // password). A server error like "Email already registered" isn't tied to a
    // single field — it goes in a separate banner above the form.
    const [serverError, setServerError] = useState<string | null>(null)

    // ── React Hook Form setup ─────────────────────────────────────────────────
    //
    // useForm() returns everything needed to manage the form.
    // The generic <RegisterFormData> makes every returned value fully typed.
    //
    // zodResolver connects Zod to React Hook Form.
    // When the form tries to submit, zodResolver runs registerSchema.parse()
    // on the form values. If it fails, errors appear in formState.errors.
    // If it passes, onSubmit receives the validated, typed data.

    const {
        register,       // Function that connects an <input> to React Hook Form
        handleSubmit,   // Wraps our onSubmit — runs validation first
        formState: {
            errors,       // Object containing validation error messages per field
            isSubmitting, // True while our async onSubmit is running
            // React Hook Form sets this automatically
        },
    } = useForm<RegisterFormData>({
        resolver: zodResolver(registerSchema),
    })

    // ── Submit handler ────────────────────────────────────────────────────────
    //
    // PURPOSE: Called by React Hook Form ONLY after Zod validation passes.
    //          Sends registration request to backend.
    //          On success: saves token via AuthContext, navigates to /teams.
    //          On failure: shows server error message.
    //
    // INPUTS:  data — the validated form values, typed as RegisterFormData
    // WHY ASYNC: We need to await the API call before navigating

    const onSubmit = async (data: RegisterFormData) => {
        // Clear any previous server error from a failed attempt
        setServerError(null)

        try {
            // POST /api/auth/register
            // axios automatically:
            //   - adds Content-Type: application/json
            //   - serialises data to JSON
            //   - throws on non-2xx responses (caught below)
            // POST /api/auth/register
            const response = await api.post('/auth/register', {
                name: data.name,
                email: data.email,
                password: data.password,
            })

            // response.data is now typed for mandatory 2FA setup
            const { tempToken, twoFactorSetup } = response.data

            // We do NOT call login() here. There is no full-access token yet.
            // Store the tempToken and setup data for the next page.
            if (tempToken) {
                sessionStorage.setItem('cloudteams_temp_token', tempToken)
            }
            if (twoFactorSetup) {
                sessionStorage.setItem(
                    'cloudteams_2fa_setup',
                    JSON.stringify(twoFactorSetup)
                )
            }

            // Always navigate to setup — cannot be skipped
            navigate('/2fa/setup', { replace: true })

        } catch (err: unknown) {
            // Axios throws on 4xx/5xx. We need to extract the error message
            // from the response body our backend sends.
            //
            // WHY THIS STRUCTURE: Our backend always sends { error: "message" }
            // on failures. We check that the error has a response property
            // (network errors don't) and that the response has our expected shape.
            if (
                err &&
                typeof err === 'object' &&
                'response' in err &&
                err.response &&
                typeof err.response === 'object' &&
                'data' in err.response
            ) {
                const data = err.response.data as { error?: string }
                setServerError(data.error ?? 'Registration failed. Please try again.')
            } else {
                // Network error — backend unreachable
                setServerError('Cannot reach the server. Check your connection.')
            }
        }
    }

    // ─── 4. RENDER ─────────────────────────────────────────────────────────

    return (
        // Full-height centered layout using Tailwind flexbox
        // min-h-screen: at least full viewport height
        // bg-gray-50: very light grey background (not pure white — easier on eyes)
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">

            {/* Card container */}
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-2xl font-semibold text-gray-900">
                        Create your account
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Already have an account?{' '}
                        {/* Link keeps navigation inside the SPA — no page reload */}
                        <Link
                            to="/login"
                            className="text-blue-600 hover:underline font-medium"
                        >
                            Sign in
                        </Link>
                    </p>
                </div>

                {/* Server error banner — only shown when serverError is not null */}
                {serverError && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
                        <p className="text-sm text-red-700">{serverError}</p>
                    </div>
                )}

                {/* Form */}
                {/* handleSubmit runs Zod validation, then calls onSubmit if valid */}
                <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
                    {/* noValidate disables the browser's built-in HTML5 validation
              popups — we're using Zod for validation, not the browser */}

                    {/* ── name field ──────────────────────────────────────────── */}
                    <div>
                        <label
                            htmlFor="name"
                            className="block text-sm font-medium text-gray-700 mb-1"
                        >
                            name
                        </label>
                        <input
                            id="name"
                            type="text"
                            // register() connects this input to React Hook Form.
                            // It injects: name, ref, onChange, onBlur
                            // The string 'username' must match a key in RegisterFormData
                            {...register('name')}
                            placeholder="e.g. alice_zhang"
                            autoComplete="name"
                            className={`
                w-full px-3 py-2 rounded-lg border text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                transition-colors
                ${errors.name
                                    ? 'border-red-400 bg-red-50'    // red border when error
                                    : 'border-gray-300 bg-white'     // normal state
                                }
              `}
                        />
                        {/* Show validation error if this field failed */}
                        {errors.name && (
                            <p className="mt-1 text-xs text-red-600">
                                {errors.name.message}
                            </p>
                        )}
                    </div>

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
                            {...register('email')}
                            placeholder="alice@university.edu"
                            autoComplete="email"
                            className={`
                w-full px-3 py-2 rounded-lg border text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                transition-colors
                ${errors.email
                                    ? 'border-red-400 bg-red-50'
                                    : 'border-gray-300 bg-white'
                                }
              `}
                        />
                        {errors.email && (
                            <p className="mt-1 text-xs text-red-600">
                                {errors.email.message}
                            </p>
                        )}
                    </div>

                    {/* ── Password field ──────────────────────────────────────────── */}
                    <div>
                        <label
                            htmlFor="password"
                            className="block text-sm font-medium text-gray-700 mb-1"
                        >
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            {...register('password')}
                            placeholder="At least 8 characters"
                            autoComplete="new-password"
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
                            <p className="mt-1 text-xs text-red-600">
                                {errors.password.message}
                            </p>
                        )}
                    </div>

                    {/* ── Submit button ───────────────────────────────────────────── */}
                    <button
                        type="submit"
                        // Disable while submitting — prevents double submission
                        disabled={isSubmitting}
                        className="
              w-full py-2.5 px-4 rounded-lg text-sm font-medium
              bg-blue-600 text-white
              hover:bg-blue-700
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
                    >
                        {/* Show different text while the request is in flight */}
                        {isSubmitting ? 'Creating account...' : 'Create account'}
                    </button>

                </form>
            </div>
        </div>
    )
}