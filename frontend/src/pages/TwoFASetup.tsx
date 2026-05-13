// src/pages/TwoFASetup.tsx
//
// PURPOSE: Shown immediately after registration.
//          Displays QR code for Google Authenticator setup.
//          User must enter one valid code to confirm setup works.
//          After verification → navigate to /teams.
//          "Skip" option lets user disable 2FA and go straight to /teams.
//
// INPUTS:  QR code data from sessionStorage (set by Register.tsx)
// OUTPUTS: 2FA setup screen with QR code + verification input

import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/api/axios'
import { useAuth } from '@/hooks/useAuth'

export default function TwoFASetup() {
    const navigate = useNavigate()
    const { login } = useAuth()

    // Read setup data from sessionStorage — set by Register.tsx after registration
    const [setupData, setSetupData] = useState<{
        qrCode: string
        secret: string
    } | null>(null)

    // 6 digit boxes — same pattern as TwoFAChallenge
    const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
    const [isVerifying, setIsVerifying] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showSecret, setShowSecret] = useState(false)  // toggle manual key visibility
    const inputRefs = useRef<(HTMLInputElement | null)[]>([])

    // ── Guard: read setup data from sessionStorage ──────────────────────────
    //
    // If someone navigates here directly without registering,
    // sessionStorage won't have the data → redirect to /teams.

    useEffect(() => {
        const raw = sessionStorage.getItem('cloudteams_2fa_setup')
        if (!raw) {
            navigate('/teams', { replace: true })
            return
        }
        try {
            setSetupData(JSON.parse(raw) as { qrCode: string; secret: string })
        } catch {
            navigate('/teams', { replace: true })
        }
    }, [navigate])

    // ── Digit input handlers — same pattern as TwoFAChallenge ──────────────

    const handleDigitChange = (index: number, value: string) => {
        const digit = value.replace(/\D/g, '').slice(-1)
        const newDigits = [...digits]
        newDigits[index] = digit
        setDigits(newDigits)
        setError(null)

        if (digit && index < 5) {
            inputRefs.current[index + 1]?.focus()
        }
        if (digit && index === 5) {
            const code = [...newDigits.slice(0, 5), digit].join('')
            if (code.length === 6) void handleVerify(code)
        }
    }

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus()
            const newDigits = [...digits]
            newDigits[index - 1] = ''
            setDigits(newDigits)
        }
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault()
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        if (!pasted) return
        const newDigits = ['', '', '', '', '', '']
        pasted.split('').forEach((d, i) => { newDigits[i] = d })
        setDigits(newDigits)
        const lastIndex = Math.min(pasted.length, 5)
        inputRefs.current[lastIndex]?.focus()
        if (pasted.length === 6) void handleVerify(pasted)
    }

    // ── Verify the code ───────────────────────────────────────────────────────
    //
    // Calls the existing verify-setup endpoint from your Week 4 backend.
    // On success: clears setup data, navigates to /teams.

    const handleVerify = async (codeOverride?: string) => {
        const code = codeOverride ?? digits.join('')
        if (code.length !== 6) {
            setError('Please enter all 6 digits.')
            return
        }

        setIsVerifying(true)
        setError(null)

        try {
            // POST /api/auth/2fa/verify-setup
            // We now use the tempToken from sessionStorage
            const tempToken = sessionStorage.getItem('cloudteams_temp_token')

            const response = await api.post('/auth/2fa/verify-setup', 
                { secret: setupData!.secret, code },
                { headers: { Authorization: `Bearer ${tempToken}` } }
            )

            const { token, user } = response.data

            // Clean up setup data
            sessionStorage.removeItem('cloudteams_2fa_setup')
            sessionStorage.removeItem('cloudteams_temp_token')

            // Complete login logic
            login(token, user)
            navigate('/teams', { replace: true })

        } catch (err: unknown) {
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
            setIsVerifying(false)
        }
    }


    // ── Loading state while sessionStorage is being read ─────────────────────

    if (!setupData) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    // ─── RENDER ──────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

                {/* Header */}
                <div className="text-center mb-6">
                    <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                            />
                        </svg>
                    </div>
                    <h1 className="text-xl font-semibold text-gray-900">
                        Set up two-factor authentication
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Scan the QR code with Google Authenticator, then enter the code to confirm.
                    </p>
                </div>

                {/* Step 1 — Scan QR code */}
                <div className="mb-6">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Step 1 — Scan with Google Authenticator
                    </p>
                    <div className="flex justify-center">
                        {/* QR code is a base64 data URL returned by the backend */}
                        <img
                            src={setupData.qrCode}
                            alt="2FA QR Code"
                            className="w-44 h-44 rounded-lg border border-gray-200"
                        />
                    </div>

                    {/* Manual entry fallback */}
                    <div className="mt-3 text-center">
                        <button
                            onClick={() => setShowSecret(!showSecret)}
                            className="text-xs text-blue-600 hover:underline"
                        >
                            {showSecret ? 'Hide' : 'Can\'t scan? Show manual key'}
                        </button>
                        {showSecret && (
                            <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                <p className="text-xs text-gray-500 mb-1">
                                    Enter this key manually in your authenticator app:
                                </p>
                                {/* font-mono makes the secret easy to read */}
                                <p className="text-sm font-mono font-semibold text-gray-900 break-all">
                                    {setupData.secret}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Step 2 — Enter verification code */}
                <div className="mb-6">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Step 2 — Enter the 6-digit code to confirm
                    </p>

                    {error && (
                        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
                            <p className="text-sm text-red-700 text-center">{error}</p>
                        </div>
                    )}

                    {/* 6 digit input boxes */}
                    <div className="flex gap-2 justify-center mb-4" onPaste={handlePaste}>
                        {digits.map((digit, index) => (
                            <input
                                key={index}
                                ref={(el) => { inputRefs.current[index] = el }}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleDigitChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                disabled={isVerifying}
                                autoFocus={index === 0}
                                className={`
                  w-11 h-14 text-center text-xl font-semibold rounded-lg border
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                  disabled:opacity-50 transition-colors
                  ${error
                                        ? 'border-red-400 bg-red-50 text-red-700'
                                        : digit
                                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                                            : 'border-gray-300 bg-white text-gray-900'
                                    }
                `}
                            />
                        ))}
                    </div>

                    {/* Verify button */}
                    <button
                        onClick={() => void handleVerify()}
                        disabled={isVerifying || digits.join('').length !== 6}
                        className="
              w-full py-2.5 px-4 rounded-lg text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-700
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
                    >
                        {isVerifying ? (
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
                            'Confirm and enable 2FA'
                        )}
                    </button>
                </div>

                <p className="text-xs text-gray-400 text-center mt-3">
                    You can manage your account security anytime from settings.
                </p>

            </div>
        </div>
    )
}