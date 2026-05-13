// src/hooks/useLockManager.ts
//
// PURPOSE: Encapsulate the full lifecycle of a file lock:
//   1. Acquire the lock when the hook mounts
//   2. Maintain the lock via a heartbeat interval every 25 seconds
//   3. Release the lock when the hook unmounts (user closes file / navigates away)
//
// WHY A CUSTOM HOOK FOR THIS:
//   Lock management has a well-defined lifecycle: acquire → keep alive → release.
//   This maps perfectly onto useEffect's mount/cleanup model.
//   Keeping this logic here means FileList and LockBanner stay declarative —
//   they just read state, they don't manage timers.
//
// INPUTS (via params object):
//   teamId  — needed for all lock URL paths (/teams/:teamId/files/:fileId/...)
//   fileId  — the specific file being locked
//   enabled — set to 'true' only when the user actively opens a file for editing
//             When 'false', the hook is dormant — no lock is acquired
//
// OUTPUTS (returned object):
//   lockedByMe    — true if THIS user holds the lock (they can edit)
//   lockExpiresAt — ISO string when the lease expires (for display only)
//   error         — string if acquiring the lock failed (e.g., already locked)
//   release       — function to manually release before unmount (e.g., Save button)

import { useState, useEffect, useCallback, useRef } from 'react'
import { lockFile, sendHeartbeat, unlockFile } from '../api/files'
import toast from 'react-hot-toast'

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface UseLockManagerParams {
  teamId: number
  fileId: number
  enabled: boolean    // only acquire lock when user intends to edit
}

interface UseLockManagerResult {
  lockedByMe: boolean
  lockExpiresAt: string | null
  error: string | null
  release: () => Promise<void>  // call this to manually release the lock
}

// How often to send a heartbeat (milliseconds).
// 25 000ms = 25 seconds. Lock expires at 30 minutes — 25s gives buffer for latency.
const HEARTBEAT_INTERVAL_MS = 25_000

// ─── HOOK ───────────────────────────────────────────────────────────────────

export function useLockManager({
  teamId,
  fileId,
  enabled,
}: UseLockManagerParams): UseLockManagerResult {

  // The lock token received after a successful acquireLock call.
  // Stored in a ref (not state) because:
  //   - We don't need the component to re-render when it changes
  //   - Refs are accessible inside setInterval callbacks without stale closure issues
  //   - We never display the token — it's only sent in heartbeat/unlock calls
  const lockTokenRef = useRef<string | null>(null)

  const [lockedByMe, setLockedByMe] = useState(false)
  const [lockExpiresAt, setLockExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Release function (also used by useEffect cleanup) ────────────────────
  // useCallback so the function reference is stable across renders.
  // If we didn't memoize, every re-render would create a new function, causing
  // the cleanup useEffect dependency array to re-run on every render.
  const release = useCallback(async () => {
    if (!lockTokenRef.current) return // nothing to release if we never acquired

    try {
      await unlockFile(teamId, fileId, lockTokenRef.current)
      // Only toast on explicit release — not during tab close / navigation
      // (those cleanup calls are fire-and-forget, user is already gone)
      toast.success('File unlocked')
    } catch {
      // We attempt release best-effort. If it fails (network error, tab crash),
      // the server-side cron job will expire the lease automatically at lockExpiresAt.
      // No need to show an error to the user here — they're already navigating away.
      console.warn('[useLockManager] Failed to release lock on cleanup — cron will expire it')
    } finally {
      // Clear local state regardless of whether the API call succeeded
      lockTokenRef.current = null
      setLockedByMe(false)
      setLockExpiresAt(null)
    }
  }, [teamId, fileId])

  // ── Main effect: acquire lock + start heartbeat ──────────────────────────
  useEffect(() => {
    if (!enabled) return  // hook is dormant — user isn't editing

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null
    let cancelled = false  // prevents state updates after cleanup runs

    const acquire = async () => {
      try {
        const result = await lockFile(teamId, fileId)

        if (cancelled) return  // component unmounted before acquire finished

        // Store the token in the ref — NOT in state (no re-render needed)
        lockTokenRef.current = result.lockToken
        setLockedByMe(true)
        setLockExpiresAt(result.lockExpiresAt)
        setError(null)
        // Toast confirms the lock was acquired — tells user they have exclusive edit rights
        toast.success('🔐 File locked — you have exclusive edit access')

        // ── Start heartbeat loop ─────────────────────────────────────────
        // setInterval runs the callback every 25 seconds.
        // Each heartbeat extends the lease another 30 minutes from NOW.
        heartbeatInterval = setInterval(async () => {
          if (!lockTokenRef.current) return  // lock was released manually

          try {
            const updated = await sendHeartbeat(teamId, fileId, lockTokenRef.current)

            if (!cancelled && updated?.lock_expires_at) {
              // Update the expiry time shown to the user
              setLockExpiresAt(updated.lock_expires_at)
            }
          } catch (heartbeatErr) {
            // Heartbeat failure could mean the lock was force-unlocked by an admin.
            // We log the warning but don't crash — next heartbeat attempt will also fail
            // and the lock will eventually expire on the server side.
            console.warn('[useLockManager] Heartbeat failed:', heartbeatErr)
          }
        }, HEARTBEAT_INTERVAL_MS)

      } catch (err: unknown) {
        if (cancelled) return

        // Common failure: 409 Conflict = another user holds the lock
        const message = (err as any)?.response?.data?.error ||
          (err as Error)?.message ||
          'Failed to acquire lock'
        setError(message)
        setLockedByMe(false)
        // Notify the user why the lock failed (e.g. "File already locked")
        toast.error(message)
      }
    }

    acquire()

    // ── Cleanup: runs when enabled → false, or component unmounts ────────
    return () => {
      cancelled = true

      // Stop the heartbeat interval first so no more API calls are made
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
      }

      // Release the lock asynchronously. We don't await here because
      // React cleanup functions cannot be async — calling release() starts
      // the async chain, and the browser keeps the lock alive until it resolves.
      release()
    }
  }, [enabled, teamId, fileId, release])
  // ↑ We include `release` in deps because ESLint requires it (it's a callback),
  //   but it's stable (useCallback with [teamId, fileId]) so no infinite loop.

  return {
    lockedByMe,
    lockExpiresAt,
    error,
    release,
  }
}
