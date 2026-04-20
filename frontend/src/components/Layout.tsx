// src/components/Layout.tsx
//
// PURPOSE: Persistent shell wrapping all protected pages.
//          Renders sidebar + top nav. Uses <Outlet /> for page content.
//          Handles sidebar collapse on mobile.
//
// INPUTS:  None (gets current route from React Router automatically)
// OUTPUTS: Full-page layout with nav + current page content

import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

// ─── NAV ITEMS ─────────────────────────────────────────────────────────────
//
// Defined as data, not hardcoded JSX.
// WHY: Adding a new nav item = adding one object here.
// No need to copy-paste JSX blocks.

interface NavItem {
    label: string
    path: string
    icon: React.ReactNode
    // SVG icon element
}

// Simple inline SVG icons — no icon library needed.
// Each is 20x20, stroke-based, matching Tailwind's text color.
const navItems: NavItem[] = [
    {
        label: 'My Teams',
        path: '/teams',
        icon: (
            // People/team icon
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                />
            </svg>
        ),
    },
    {
        label: 'Join a team',
        path: '/join',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
            </svg>
        ),
    },
]

// ─── LAYOUT COMPONENT ──────────────────────────────────────────────────────

export default function Layout() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()

    // Controls sidebar visibility on mobile.
    // On desktop (md breakpoint and above) sidebar is always visible via CSS.
    // On mobile, toggled by the hamburger button.
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)

    const handleLogout = async () => {
        try {
            // Call backend logout endpoint to blacklist the token.
            // We import api lazily here to avoid circular imports
            // (axios.ts → AuthContext → Layout).
            // WHY fire-and-forget with void: even if the backend call fails,
            // we still want to clear the local session. The user shouldn't be
            // stuck logged in because the server had a hiccup.
            const { default: api } = await import('@/api/axios')
            void api.post('/auth/logout').catch(() => {
                // Silently ignore — local logout still happens below
            })
        } finally {
            // logout() from AuthContext:
            //   1. Clears localStorage
            //   2. Clears React state
            //   3. Redirects to /login via window.location.href
            logout()
        }
    }

    // Get the first letter of the user's name for the avatar circle.
    // Falls back to '?' if user is somehow null (shouldn't happen inside Layout
    // since ProtectedRoute guards it, but TypeScript needs the safety check).
    const displayName = user?.name ?? user?.username ?? 'User'
    const avatarLetter = displayName.charAt(0).toUpperCase()
    return (
        // Full-height flex container — sidebar left, main right
        <div className="flex h-screen bg-gray-50 overflow-hidden">

            {/* ── MOBILE OVERLAY ────────────────────────────────────────────────
          Dark backdrop behind the sidebar on mobile when it's open.
          Clicking it closes the sidebar.
          Hidden on desktop (md:hidden). */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 z-20 bg-black/40 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* ── SIDEBAR ───────────────────────────────────────────────────────
          Fixed on mobile (slides in/out), static on desktop.
          z-30 keeps it above the overlay on mobile. */}
            <aside
                className={`
          fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200
          flex flex-col
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
            >
                {/* Logo / brand */}
                <div className="h-16 flex items-center px-6 border-b border-gray-200 flex-shrink-0">
                    <span className="text-lg font-semibold text-gray-900">
                        ☁️ CloudTeams
                    </span>
                </div>

                {/* Nav links */}
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                    {navItems.map((item) => (
                        // NavLink is React Router's version of Link with active state.
                        // It automatically adds styling when the current URL matches the path.
                        // The `end` prop means /teams only matches exactly /teams,
                        // not /teams/123 — prevents the Teams link staying active on detail pages.
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end
                            onClick={() => setIsSidebarOpen(false)}  // close sidebar on mobile
                            className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                transition-colors font-medium
                ${isActive
                                    ? 'bg-blue-50 text-blue-700'      // active: blue highlight
                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                }
              `}
                        >
                            {item.icon}
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                {/* Bottom section — user info + logout */}
                <div className="flex-shrink-0 border-t border-gray-200 p-4">

                    {/* User info row */}
                    <div className="flex items-center gap-3 mb-3">
                        {/* Avatar circle with user's initial */}
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-white">
                                {avatarLetter}
                            </span>
                        </div>
                        <div className="min-w-0 flex-1">
                            {/* truncate cuts off long names with "..." */}
                            <p className="text-sm font-medium text-gray-900 truncate">
                                {displayName}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                                {user?.email ?? ''}
                            </p>
                        </div>
                    </div>

                    {/* Logout button */}
                    <button
                        onClick={handleLogout}
                        className="
              w-full flex items-center gap-2 px-3 py-2 rounded-lg
              text-sm text-gray-600
              hover:bg-red-50 hover:text-red-600
              transition-colors
            "
                    >
                        {/* Logout / door icon */}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
                        </svg>
                        Sign out
                    </button>
                </div>
            </aside>

            {/* ── MAIN AREA (top nav + page content) ───────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* Top nav bar */}
                <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 gap-4 flex-shrink-0">

                    {/* Hamburger button — mobile only */}
                    <button
                        className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                        onClick={() => setIsSidebarOpen(true)}
                        aria-label="Open menu"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 6h16M4 12h16M4 18h16"
                            />
                        </svg>
                    </button>

                    {/* Page title area — grows to fill available space */}
                    <div className="flex-1">
                        <h1 className="text-base font-semibold text-gray-900">
                            CloudTeams
                        </h1>
                    </div>

                    {/* Right side — avatar button that navigates to teams on click */}
                    <button
                        onClick={() => navigate('/teams')}
                        className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 hover:bg-blue-700 transition-colors"
                        aria-label="Go to teams"
                    >
                        <span className="text-xs font-semibold text-white">
                            {avatarLetter}
                        </span>
                    </button>
                </header>

                {/* Page content — scrollable, Outlet renders current route */}
                <main className="flex-1 overflow-y-auto">
                    {/* Outlet renders whichever child route matches the current URL.
              This is where TeamList, TeamDashboard, FileBrowser etc. appear. */}
                    <Outlet />
                </main>

            </div>
        </div>
    )
}