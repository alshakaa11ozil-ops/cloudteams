// src/components/LockBanner.tsx
// PURPOSE: Yellow warning bar shown when a file is locked by another user.
// INPUTS:  lockedByUsername — the name of the user who holds the lock
//          lockExpiresAt    — ISO string when the lease expires (for display)
//          onForceUnlock    — optional callback (only visible to admins)

interface LockBannerProps {
  lockedByUsername: string
  lockExpiresAt: string | null
  onForceUnlock?: () => void
}

export default function LockBanner({ lockedByUsername, lockExpiresAt, onForceUnlock }: LockBannerProps) {
  // Format expiry time as a relative string, e.g. "in 28 minutes"
  const expiryLabel = (() => {
    if (!lockExpiresAt) return ''
    const diff = new Date(lockExpiresAt).getTime() - Date.now()
    if (diff <= 0) return '(expired)'
    const mins = Math.ceil(diff / 60_000)
    return `(expires in ${mins}m)`
  })()

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm">
      {/* Lock icon */}
      <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>

      <span className="text-amber-800 flex-1">
        <span className="font-semibold">{lockedByUsername}</span> is currently editing this file {expiryLabel}
      </span>

      {/* Force unlock — only rendered if callback provided (admin only) */}
      {onForceUnlock && (
        <button
          onClick={onForceUnlock}
          className="text-xs text-amber-700 hover:text-amber-900 font-medium underline flex-shrink-0"
        >
          Force unlock
        </button>
      )}
    </div>
  )
}
