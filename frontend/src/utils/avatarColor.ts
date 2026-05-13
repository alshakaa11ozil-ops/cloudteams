// frontend/src/utils/avatarColor.ts
//
// PURPOSE: Generate a consistent color for a user's avatar based on their ID.
//          Same user always gets the same color — no randomness per session.
//
// WHY NOT RANDOM: Random colors change on every reload, which looks broken.
//   Deterministic colors based on user ID feel like a real system.

// 10 professional colors — not too bright, readable with white text
const AVATAR_COLORS = [
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#6366f1', // indigo
]

// PURPOSE: Get a consistent color for a user based on their ID
// INPUTS:  userId — number
// OUTPUTS: hex color string
export function getAvatarColor(userId: number): string {
    // Modulo maps any userId to one of the 10 colors
    // Same userId always produces same index — deterministic
    return AVATAR_COLORS[userId % AVATAR_COLORS.length]
}

// PURPOSE: Get initials from a user's display name
// Tries full_name first, falls back to username
export function getInitials(fullName: string | null, username: string): string {
    const name = fullName?.trim() || username
    const parts = name.split(' ').filter(Boolean)
    if (parts.length >= 2) {
        // "John Doe" → "JD"
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    // "alice" → "A"
    return name.charAt(0).toUpperCase()
}