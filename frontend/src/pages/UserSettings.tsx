// frontend/src/pages/UserSettings.tsx
//
// PURPOSE: User-level account settings.
//          Profile section: full name, username, job title + live avatar preview.
//          Security section: change password.
//
// ROUTE: /settings — inside ProtectedRoute + Layout
// ACCESS: Any logged-in user (not team-specific)

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import api from '@/api/axios'
import { getAvatarColor, getInitials } from '@/utils/avatarColor'
import { setup2FA, verifyAndEnable2FA, disable2FA } from '@/api/auth'

export default function UserSettings() {
    const { user, refreshUser } = useAuth()
    const navigate = useNavigate()

    // Profile form — pre-filled from current user data
    const [username, setUsername] = useState(user?.username ?? '')
    const [fullName, setFullName] = useState(user?.full_name ?? '')
    const [jobTitle, setJobTitle] = useState(user?.job_title ?? '')

    // Password form
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')

    // Derived validation
    const passwordsMatch = newPassword === confirmPassword
    const newPasswordLongEnough = newPassword.length >= 8

    // Live avatar preview — reflects what they're typing
    const previewInitials = getInitials(fullName || null, username || user?.username || '?')
    const avatarColor = getAvatarColor(user?.id ?? 0)

    // ── Profile mutation ─────────────────────────────────────────────────────
    const profileMutation = useMutation({
        mutationFn: () => api.patch('/auth/profile', {
            username: username.trim() || undefined,
            full_name: fullName.trim() || null,
            job_title: jobTitle.trim() || null,
        }),
        onSuccess: async () => {
            await refreshUser()   // updates sidebar avatar + display name instantly
            toast.success('Profile updated')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to update profile')
        }
    })

    // ── Password mutation ────────────────────────────────────────────────────
    const passwordMutation = useMutation({
        mutationFn: () => api.patch('/auth/password', { currentPassword, newPassword }),
        onSuccess: () => {
            toast.success('Password changed successfully')
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to change password')
        }
    })

    // Is the profile form dirty (has unsaved changes)?
    const isProfileDirty =
        username.trim() !== (user?.username ?? '') ||
        fullName.trim() !== (user?.full_name ?? '') ||
        jobTitle.trim() !== (user?.job_title ?? '')

    return (
        <div className="p-6 max-w-2xl mx-auto">

            {/* Header */}
            <div className="mb-8">
                <button
                    onClick={() => navigate(-1)}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back
                </button>
                <h1 className="text-2xl font-semibold text-gray-900">Account settings</h1>
                <p className="text-sm text-gray-500 mt-1">Manage your profile and security settings.</p>
            </div>

            <div className="space-y-6">

                {/* ── Profile section ───────────────────────────────────────────── */}
                <section className="bg-white rounded-xl border border-gray-200 p-6">
                    <h2 className="text-base font-semibold text-gray-900 mb-1">Profile</h2>
                    <p className="text-sm text-gray-500 mb-6">
                        How you appear to your teammates across CloudTeams.
                    </p>

                    {/* Avatar preview */}
                    <div className="flex items-center gap-5 mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                        {/* 
              Live avatar preview — updates as user types their name.
              Shows exactly what teammates will see in member lists,
              comments, and activity feeds.
            */}
                        <div
                            className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 text-xl font-bold text-white shadow-sm"
                            style={{ backgroundColor: avatarColor }}
                        >
                            {previewInitials}
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-gray-900">
                                {fullName.trim() || username.trim() || user?.username}
                            </p>
                            {jobTitle.trim() && (
                                <p className="text-sm text-gray-500">{jobTitle.trim()}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-1">{user?.email}</p>
                            <p className="text-xs text-gray-400 mt-1 italic">
                                Avatar uses your initials — updates automatically
                            </p>
                        </div>
                    </div>

                    {/* Form fields */}
                    <div className="space-y-4 max-w-md">

                        {/* Full name */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Full name
                                <span className="text-gray-400 font-normal ml-1">(optional)</span>
                            </label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={e => setFullName(e.target.value)}
                                placeholder="e.g. Abdullah Alshaka"
                                maxLength={100}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                Shown in member lists and activity feed when set
                            </p>
                        </div>

                        {/* Username */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Username <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                maxLength={30}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>

                        {/* Job title */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Job title
                                <span className="text-gray-400 font-normal ml-1">(optional)</span>
                            </label>
                            <input
                                type="text"
                                value={jobTitle}
                                onChange={e => setJobTitle(e.target.value)}
                                placeholder="e.g. Software Engineer, Student, Designer"
                                maxLength={100}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>

                        {/* Email — read only */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Email address
                            </label>
                            <input
                                type="text"
                                value={user?.email ?? ''}
                                disabled
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                            />
                            <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
                        </div>

                        <button
                            onClick={() => profileMutation.mutate()}
                            disabled={!isProfileDirty || !username.trim() || profileMutation.isPending}
                            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {profileMutation.isPending ? 'Saving...' : 'Save profile'}
                        </button>
                    </div>
                </section>

                {/* ── Security section ──────────────────────────────────────────── */}
                <section className="bg-white rounded-xl border border-gray-200 p-6">
                    <h2 className="text-base font-semibold text-gray-900 mb-1">Security</h2>
                    <p className="text-sm text-gray-500 mb-6">Change your account password.</p>

                    <div className="space-y-4 max-w-md">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Current password
                            </label>
                            <input
                                type="password"
                                value={currentPassword}
                                onChange={e => setCurrentPassword(e.target.value)}
                                placeholder="Enter your current password"
                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                New password
                            </label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                placeholder="Minimum 8 characters"
                                className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 ${newPassword && !newPasswordLongEnough ? 'border-red-300' : 'border-gray-300'
                                    }`}
                            />
                            {newPassword && !newPasswordLongEnough && (
                                <p className="text-xs text-red-500 mt-1">Minimum 8 characters required</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Confirm new password
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="Repeat your new password"
                                className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 ${confirmPassword && !passwordsMatch ? 'border-red-300' : 'border-gray-300'
                                    }`}
                            />
                            {confirmPassword && !passwordsMatch && (
                                <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                            )}
                        </div>

                        <button
                            onClick={() => passwordMutation.mutate()}
                            disabled={
                                !currentPassword || !newPassword || !confirmPassword ||
                                !passwordsMatch || !newPasswordLongEnough ||
                                passwordMutation.isPending
                            }
                            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {passwordMutation.isPending ? 'Changing...' : 'Change password'}
                        </button>
                    </div>
                </section>

                {/* ── Two-factor authentication section ───────────────────────── */}
                <TwoFactorSection />

            </div>
        </div>
    )
}

function TwoFactorSection() {
    const { user, refreshUser } = useAuth()

    // Whether this user currently has 2FA enabled
    // The User type doesn't have two_factor_confirmed — we infer from
    // a separate endpoint or we add it to the User type
    // For now: track state locally, updated by enable/disable actions
    const [isEnabled, setIsEnabled] = useState(user?.twoFactorEnabled ?? false)
    const [setupData, setSetupData] = useState<{ qrCodeDataUrl: string; secret: string } | null>(null)
    const [verifyCode, setVerifyCode] = useState('')
    const [disableCode, setDisableCode] = useState('')
    const [showDisableForm, setShowDisableForm] = useState(false)

    // Setup mutation — get QR code
    const setupMutation = useMutation({
        mutationFn: setup2FA,
        onSuccess: (data) => {
            setSetupData(data)
            toast('Scan the QR code with your authenticator app', { icon: '📱' })
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to start 2FA setup')
        }
    })

    // Verify + enable mutation
    const enableMutation = useMutation({
        mutationFn: () => verifyAndEnable2FA(setupData!.secret, verifyCode),
        onSuccess: async () => {
            setIsEnabled(true)
            setSetupData(null)
            setVerifyCode('')
            await refreshUser()
            toast.success('Two-factor authentication enabled ✓')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Invalid code — try again')
        }
    })

    // Disable mutation
    const disableMutation = useMutation({
        mutationFn: () => disable2FA(disableCode),
        onSuccess: async () => {
            setIsEnabled(false)
            setShowDisableForm(false)
            setDisableCode('')
            await refreshUser()
            toast.success('Two-factor authentication disabled')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Invalid code — 2FA not disabled')
        }
    })

    return (
        <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-semibold text-gray-900">
                    Two-factor authentication
                </h2>
                {/* Status badge */}
                <span className={`
          text-xs font-semibold px-2.5 py-1 rounded-full
          ${isEnabled
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }
        `}>
                    {isEnabled ? '✓ Enabled' : 'Disabled'}
                </span>
            </div>
            <p className="text-sm text-gray-500 mb-6">
                Add an extra layer of security. When enabled, you'll need your
                authenticator app code every time you log in.
            </p>

            {/* ── State: 2FA disabled, not setting up ─────────────────────── */}
            {!isEnabled && !setupData && (
                <button
                    onClick={() => setupMutation.mutate()}
                    disabled={setupMutation.isPending}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                    {setupMutation.isPending ? 'Setting up...' : 'Enable 2FA'}
                </button>
            )}

            {/* ── State: QR code shown, waiting for verification ──────────── */}
            {setupData && (
                <div className="space-y-4 max-w-sm">
                    <p className="text-sm text-gray-700 font-medium">
                        Step 1: Scan this QR code with Google Authenticator or Authy
                    </p>

                    {/* QR Code image */}
                    <div className="p-4 bg-white border-2 border-gray-200 rounded-xl inline-block">
                        <img
                            src={setupData.qrCodeDataUrl}
                            alt="2FA QR Code"
                            className="w-48 h-48"
                        />
                    </div>

                    {/* Manual entry fallback */}
                    <details className="text-xs text-gray-500">
                        <summary className="cursor-pointer hover:text-gray-700">
                            Can't scan? Enter code manually
                        </summary>
                        <code className="mt-2 block p-2 bg-gray-50 rounded border text-xs font-mono break-all">
                            {setupData.secret}
                        </code>
                    </details>

                    <p className="text-sm text-gray-700 font-medium">
                        Step 2: Enter the 6-digit code from your app to confirm
                    </p>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={verifyCode}
                            onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            maxLength={6}
                            className="w-32 px-3 py-2 text-center text-lg font-mono tracking-widest border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            onClick={() => enableMutation.mutate()}
                            disabled={verifyCode.length !== 6 || enableMutation.isPending}
                            className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                            {enableMutation.isPending ? 'Verifying...' : 'Verify & Enable'}
                        </button>
                        <button
                            onClick={() => { setSetupData(null); setVerifyCode('') }}
                            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* ── State: 2FA enabled ───────────────────────────────────────── */}
            {isEnabled && !showDisableForm && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                            />
                        </svg>
                        Your account is protected with two-factor authentication.
                    </div>
                    <button
                        onClick={() => setShowDisableForm(true)}
                        className="text-sm text-red-600 hover:text-red-800 font-medium"
                    >
                        Disable 2FA
                    </button>
                </div>
            )}

            {/* ── State: Disable confirmation form ────────────────────────── */}
            {isEnabled && showDisableForm && (
                <div className="space-y-3 max-w-sm">
                    <p className="text-sm text-gray-700">
                        Enter your current authenticator code to confirm disabling 2FA:
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={disableCode}
                            onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            maxLength={6}
                            autoFocus
                            className="w-32 px-3 py-2 text-center text-lg font-mono tracking-widest border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                        <button
                            onClick={() => disableMutation.mutate()}
                            disabled={disableCode.length !== 6 || disableMutation.isPending}
                            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                            {disableMutation.isPending ? 'Disabling...' : 'Disable 2FA'}
                        </button>
                        <button
                            onClick={() => { setShowDisableForm(false); setDisableCode('') }}
                            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}