// src/pages/TwoFAChallenge.tsx
//
// PURPOSE: Second step of login for users with 2FA enabled.
//          Reads tempToken from sessionStorage (set by Login.tsx).
//          Collects 6-digit TOTP code, sends to backend, completes login.
//
// INPUTS:  None (reads tempToken from sessionStorage)
// OUTPUTS: 2FA code entry form

import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { verify2FA } from '../api/auth'

export default function TwoFAChallenge() {
    const navigate = useNavigate()
    const { login } = useAuth()

    // 6 individual digit inputs — better UX than one text field.
    // WHY: Each box accepts one digit, auto-advances to next,
    // feels like a proper OTP experience on both desktop and mobile.
    const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Refs for each input — lets us programmatically focus the next box
    // when the user types a digit.
    // WHY useRef array: focus() is a DOM operation, not a React state operation.
    const inputRefs = useRef<(HTMLInputElement | null)[]>([])

    // ── Guard: redirect if no tempToken ──────────────────────────────────────
    //
    // If someone navigates to /2fa directly without going through login,
    // there's no tempToken — send them back to /login.
    // WHY useEffect: we need to check sessionStorage after mount,
    // not during render (same reason as AuthProvider reads localStorage).

    useEffect(() => {
        const tempToken = sessionStorage.getItem('cloudteams_temp_token')
        if (!tempToken) {
            navigate('/login', { replace: true })
        }
    }, [navigate])

    // ── Handle digit input ────────────────────────────────────────────────────
    //
    // Called when the user types in any of the 6 digit boxes.
    // index: which box (0-5)
    // value: what was typed

    const handleDigitChange = (index: number, value: string) => {
        // Only accept single digits 0-9
        // WHY replace: handles paste of multiple digits or non-numeric input
        const digit = value.replace(/\D/g, '').slice(-1)

        // Update the digits array immutably
        const newDigits = [...digits]
        newDigits[index] = digit
        setDigits(newDigits)
        setError(null)

        // Auto-advance to next input after typing a digit
        if (digit && index < 5) {
            inputRefs.current[index + 1]?.focus()
        }

        // Auto-submit when all 6 digits are filled
        // WHY: Removes the need to click a button — standard OTP UX
        if (digit && index === 5) {
            const code = [...newDigits.slice(0, 5), digit].join('')
            if (code.length === 6) {
                void handleSubmit(code)
            }
        }
    }

    // ── Handle backspace ──────────────────────────────────────────────────────
    //
    // When user presses backspace on an empty box, move focus to previous box.
    // WHY: Without this, the user has to click the previous box manually —
    // very frustrating when correcting a digit.

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            // Move focus back
            inputRefs.current[index - 1]?.focus()
            // Clear the previous box
            const newDigits = [...digits]
            newDigits[index - 1] = ''
            setDigits(newDigits)
        }
    }

    // ── Handle paste ──────────────────────────────────────────────────────────
    //
    // User copies the 6-digit code from their authenticator app and pastes it.
    // We distribute the digits across all 6 boxes automatically.

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault()
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        if (!pasted) return

        const newDigits = ['', '', '', '', '', '']
        pasted.split('').forEach((d, i) => { newDigits[i] = d })
        setDigits(newDigits)

        // Focus the last filled box or the last box
        const lastIndex = Math.min(pasted.length, 5)
        inputRefs.current[lastIndex]?.focus()

        // Auto-submit if full code was pasted
        if (pasted.length === 6) {
            void handleSubmit(pasted)
        }
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    const handleSubmit = async (codeOverride?: string) => {
        const code = codeOverride ?? digits.join('')

        if (code.length !== 6) {
            setError('Please enter all 6 digits.')
            return
        }

        const tempToken = sessionStorage.getItem('cloudteams_temp_token')
        if (!tempToken) {
            // Token disappeared — send back to login
            navigate('/login', { replace: true })
            return
        }

        setIsSubmitting(true)
        setError(null)

        try {
            const response = await verify2FA(code, tempToken)

            // Success — clean up tempToken, complete login
            sessionStorage.removeItem('cloudteams_temp_token')
            login(response.token, response.user)
            navigate('/teams', { replace: true })

        } catch (err: unknown) {
            // Wrong code — clear inputs, focus first box, show error
            setDigits(['', '', '', '', '', ''])
            inputRefs.current[0]?.focus()

            if (
                err &&
                typeof err === 'object' &&
                'response' in err &&
                err.response &&
                typeof err.response === 'object' &&
                'data' in err.response
            ) {
                const data = err.response.data as { error?: string }
                setError(data.error ?? 'Invalid code. Please try again.')
            } else {
                setError('Cannot reach the server. Check your connection.')
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    // ─── RENDER ──────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

                {/* Header */}
                <div className="text-center mb-8">
                    {/* Lock icon */}
                    <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                            />
                        </svg>
                    </div>
                    <h1 className="text-xl font-semibold text-gray-900">
                        Two-factor authentication
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Enter the 6-digit code from your authenticator app
                    </p>
                </div>

                {/* Error banner */}
                {error && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
                        <p className="text-sm text-red-700 text-center">{error}</p>
                    </div>
                )}

                {/* 6 digit boxes */}
                <div
                    className="flex gap-2 justify-center mb-8"
                    onPaste={handlePaste}
                >
                    {digits.map((digit, index) => (
                        <input
                            key={index}
                            ref={(el) => { inputRefs.current[index] = el }}
                            type="text"
                            inputMode="numeric"    // shows numeric keyboard on mobile
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleDigitChange(index, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(index, e)}
                            disabled={isSubmitting}
                            // autoFocus on first box when page loads
                            autoFocus={index === 0}
                            className={`
                w-11 h-14 text-center text-xl font-semibold rounded-lg border
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
                ${error
                                    ? 'border-red-400 bg-red-50 text-red-700'
                                    : digit
                                        ? 'border-blue-400 bg-blue-50 text-blue-700'   // filled
                                        : 'border-gray-300 bg-white text-gray-900'      // empty
                                }
              `}
                        />
                    ))}
                </div>

                {/* Submit button */}
                <button
                    onClick={() => void handleSubmit()}
                    disabled={isSubmitting || digits.join('').length !== 6}
                    className="
            w-full py-2.5 px-4 rounded-lg text-sm font-medium
            bg-blue-600 text-white
            hover:bg-blue-700
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
                >
                    {isSubmitting ? (
                        <span className="inline-flex items-center gap-2 justify-center">
                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10"
                                    stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Verifying...
                        </span>
                    ) : (
                        'Verify code'
                    )}
                </button>

                {/* Back to login */}
                <div className="mt-4 text-center">
                    <button
                        onClick={() => {
                            sessionStorage.removeItem('cloudteams_temp_token')
                            navigate('/login')
                        }}
                        className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                    >
                        ← Back to login
                    </button>
                </div>

            </div>
        </div>
    )
}