// =============================================================================
// src/components/editor/PresenceBar.tsx
//
// PURPOSE: Shows live avatar chips for every user currently editing the same
//          document. Powered by the Yjs Awareness Protocol.
//
// WHAT IS YJS AWARENESS:
//   Yjs has two data layers:
//     1. The Y.Doc — the CRDT document itself (text, formatting, structure)
//     2. The Awareness — ephemeral, per-client key-value store for transient
//        state (cursor position, user name, color, online status)
//
//   Awareness is broadcast over the same WebSocket as document sync.
//   It is NOT persisted to the database — when a client disconnects,
//   their Awareness entry is automatically removed.
//
// HOW THIS COMPONENT WORKS:
//   1. On mount, we subscribe to `awareness.on('change', ...)`.
//      This fires whenever any client joins, leaves, or updates its state.
//   2. We read `awareness.getStates()` — a Map of clientId → state object.
//      Each state has { user: { name, color } } (set by CollaborationCursor).
//   3. We filter out our own client (awareness.clientID) so we don't show
//      ourselves in the "others online" bar. We show ourselves separately.
//   4. We render a coloured avatar chip per unique user.
//
// WHY FILTER BY clientID (not userId):
//   Multiple browser tabs could be open for the same user. clientID is unique
//   per browser tab. userId could appear twice if same user has two tabs open.
//   We track by clientID and display unique names to avoid duplicate chips.
//
// WHY EPHEMERAL (no backend):
//   Presence data has no value after the session ends. Storing it in the DB
//   would add write overhead and require cleanup. The Awareness Protocol
//   natively handles join/leave/disconnect via its own heartbeat mechanism.
// =============================================================================

import { useEffect, useState } from 'react'
import { HocuspocusProvider } from '@hocuspocus/provider'

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface OnlineUser {
  clientId: number      // Yjs clientID — unique per browser tab
  name: string          // Display name (full_name ?? username ?? 'Anonymous')
  color: string         // Hex color for avatar bg (from CollaborationCursor config)
}

interface PresenceBarProps {
  provider: HocuspocusProvider
  currentUser: { id: number; username?: string; full_name: string | null }
}

// ---------------------------------------------------------------------------
// HELPER: getInitials
// ---------------------------------------------------------------------------
// PURPOSE: Extract up to 2 initials from a name string.
// EXAMPLES:
//   "Alice Johnson" → "AJ"
//   "bob"           → "B"
//   "Anonymous"     → "AN"
// ---------------------------------------------------------------------------
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

// ---------------------------------------------------------------------------
// COMPONENT: PresenceBar
// ---------------------------------------------------------------------------
export default function PresenceBar({ provider, currentUser }: PresenceBarProps) {

  // The list of OTHER users currently online in this document.
  // WHY exclude self: We know we're here — showing your own chip is redundant
  // and confusing ("why is my name there twice?").
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])

  useEffect(() => {
    const awareness = provider.awareness
    if (!awareness) return

    // ── Read current awareness states ────────────────────────────────────────
    // Called once on mount and every time the awareness state changes.
    const syncStates = () => {
      const states = awareness.getStates()
      const myClientId = awareness.clientID

      // Map of name → OnlineUser (last one wins if same name appears twice)
      const uniqueUsers = new Map<string, OnlineUser>()

      states.forEach((state, clientId) => {
        // Skip our own cursor — we know we're here
        if (clientId === myClientId) return

        // Skip states with no user info (clients that haven't set their name yet)
        if (!state?.user?.name) return

        const name = state.user.name as string
        // If same name already in map, keep existing (first tab's entry)
        if (!uniqueUsers.has(name)) {
          uniqueUsers.set(name, {
            clientId,
            name,
            color: (state.user.color as string) ?? '#6366f1',
          })
        }
      })

      setOnlineUsers(Array.from(uniqueUsers.values()))
    }

    // ── Subscribe to awareness changes ───────────────────────────────────────
    // 'change' fires when: a client joins, leaves, or updates their state.
    // We re-read all states on every change — simple and correct.
    awareness.on('change', syncStates)

    // Sync immediately on mount to catch users who were already online
    syncStates()

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      awareness.off('change', syncStates)
    }
  }, [provider])

  // ─── Compute own display name ─────────────────────────────────────────────
  const myName = currentUser.full_name ?? currentUser.username ?? 'Me'

  // ─── Total people in the room (us + others) ───────────────────────────────
  const totalCount = onlineUsers.length + 1

  const MAX_VISIBLE = 4
  const visibleUsers = onlineUsers.slice(0, MAX_VISIBLE)
  const overflowCount = onlineUsers.length - MAX_VISIBLE

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------
  return (
    <div className="flex items-center gap-2">

      {/* Live user count pill */}
      <span className="text-xs text-slate-400 font-medium">
        {totalCount === 1 ? 'Only you' : `${totalCount} editing`}
      </span>

      {/* Avatar chips — overlapping stack (rightmost = most recent) */}
      <div className="flex items-center">

        {/* Other users — map over visibleUsers */}
        {visibleUsers.map((u, i) => (
          <div
            key={u.clientId}
            title={`${u.name} — editing now`}
            className="
              w-7 h-7 rounded-full flex items-center justify-center
              text-white text-[10px] font-bold border-2 border-slate-800
              cursor-default select-none transition-transform hover:scale-110 hover:z-10
            "
            style={{
              backgroundColor: u.color,
              // Overlap chips: each is shifted left by 8px
              marginLeft: i === 0 ? 0 : '-8px',
              zIndex: visibleUsers.length - i,
            }}
          >
            {getInitials(u.name)}
          </div>
        ))}

        {/* Overflow badge */}
        {overflowCount > 0 && (
          <div
            title={onlineUsers.slice(MAX_VISIBLE).map(u => u.name).join(', ')}
            className="
              w-7 h-7 rounded-full flex items-center justify-center
              text-white text-[10px] font-bold border-2 border-slate-800
              bg-slate-600 cursor-default
            "
            style={{ marginLeft: '-8px', zIndex: 0 }}
          >
            +{overflowCount}
          </div>
        )}

        {/* Your own chip — always last (rightmost), always visible */}
        <div
          title={`${myName} (you) — editing now`}
          className="
            w-7 h-7 rounded-full flex items-center justify-center
            text-white text-[10px] font-bold border-2 border-indigo-400
            cursor-default select-none ring-2 ring-indigo-500 ring-offset-1 ring-offset-slate-800
          "
          style={{
            backgroundColor: '#6366f1', // Always indigo for self
            marginLeft: onlineUsers.length === 0 ? 0 : '-8px',
            zIndex: onlineUsers.length + 1,
          }}
        >
          {getInitials(myName)}
        </div>
      </div>

    </div>
  )
}
