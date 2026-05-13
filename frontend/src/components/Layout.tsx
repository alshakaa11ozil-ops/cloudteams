// src/components/Layout.tsx
//
// PURPOSE: Persistent shell wrapping all protected pages.
//          Renders sidebar + top nav. Uses <Outlet /> for page content.
//          Handles sidebar collapse on mobile.
//
// INPUTS:  None (gets current route from React Router automatically)
// OUTPUTS: Full-page layout with nav + current page content

import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useMatch } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useTeamSocket } from '@/hooks/useTeamSocket'
import { fetchTeamMembers } from '@/api/teams'
import { getAvatarColor, getInitials } from '@/utils/avatarColor'

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
    {
        label: 'Account settings',
        path: '/settings',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
        ),
    },
]

// Nav items shown when inside a specific team
// The paths here don't have teamId prepended yet — we'll do that dynamically in the render logic
const teamNavItems: NavItem[] = [
    {
        label: 'Dashboard',
        path: '', // empty to match `/teams/:id` exactly
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
        ),
    },
    {
        label: 'Members',
        path: '/members',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                />
            </svg>
        ),
    },
    {
        label: 'Files',
        path: '/files',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
        ),
    },
    {
        label: 'Activity',
        path: '/activity',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
    {
        label: 'Analytics',
        path: '/analytics',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
        ),
    },
    {
        label: 'Recycle Bin',
        path: '/recycle-bin',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
        ),
    },
]

// ─── LAYOUT COMPONENT ──────────────────────────────────────────────────────

export default function Layout() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()

    // Are we inside a specific team?
    // This matches /teams/123, /teams/123/files, etc.
    const teamMatch = useMatch('/teams/:id/*')

    // Extract the team ID if we are inside a team context.
    // If teamMatch is null (meaning we're at /teams or /join), this will be undefined.
    // However, if the user navigates directly to /teams/create, we don't want to show
    // team navigation since 'create' is not a valid numeric ID.
    const isCreateRoute = useMatch('/teams/create')
    const teamId = (!isCreateRoute && teamMatch?.params.id) ? teamMatch.params.id : null
    const parsedTeamId = teamId ? parseInt(teamId, 10) : 0

    // Determine which nav list to render
    const activeNavItems = teamId ? teamNavItems : navItems

    // Controls sidebar visibility on mobile.
    // On desktop (md breakpoint and above) sidebar is always visible via CSS.
    // On mobile, toggled by the hamburger button.
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)

    // Fetch current user's role in this team
    const { data: members = [] } = useQuery({
        queryKey: ['team-members', parsedTeamId],
        queryFn: () => fetchTeamMembers(parsedTeamId),
        enabled: parsedTeamId > 0,
    })

    const userRole = members.find(m => m.user_id === user?.id)?.role

    // User display constants
    const displayName = user?.full_name ?? user?.username ?? 'User'
    const initials = getInitials(user?.full_name ?? null, user?.username ?? '?')
    const avatarColor = getAvatarColor(user?.id ?? 0)

    // Mount the central socket handler for ALL team real-time events.
    // WHY HERE: Layout wraps every team page — mounting here means
    // the socket is connected for the entire team session, not just
    // on specific pages. When teamId is 0 (no team context), the
    // hook checks internally and does nothing.
    useTeamSocket({ teamId: parsedTeamId })

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

    // Are we inside a specific team?
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
                    {/* Optional: 'Back to Teams' button shown only when inside a team */}
                    {teamId && (
                        <div className="mb-4">
                            <NavLink
                                to="/teams"
                                onClick={() => setIsSidebarOpen(false)}
                                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                </svg>
                                Back to all teams
                            </NavLink>
                            <hr className="my-2 border-gray-200 mx-3" />
                        </div>
                    )}

                    {activeNavItems.map((item) => {
                        // Prepend /teams/:id if we're rendering team links
                        const finalPath = teamId ? `/teams/${teamId}${item.path}` : item.path

                        return (
                            <NavLink
                                key={finalPath}
                                to={finalPath}
                                end={item.path === '' || item.path === '/teams'} // 'end' required to stop Dashboard/My Teams remaining active on child routes
                                onClick={() => setIsSidebarOpen(false)}
                                className={({ isActive }) => `
                                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                                    transition-colors font-medium
                                    ${isActive
                                        ? 'bg-blue-50 text-blue-700'
                                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                    }
                                `}
                            >
                                {item.icon}
                                {item.label}
                            </NavLink>
                        )
                    })}

                    {/* Team Settings — admins only */}
                    {teamId && userRole === 'admin' && (
                        <NavLink
                            to={`/teams/${teamId}/settings`}
                            onClick={() => setIsSidebarOpen(false)}
                            className={({ isActive }) => `
                                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                                transition-colors font-medium
                                ${isActive
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                }
                            `}
                        >
                            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                                />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                            </svg>
                            Settings
                        </NavLink>
                    )}

                    {/* Invite Member — admins only */}
                    {teamId && userRole === 'admin' && (
                        <NavLink
                            to={`/teams/${teamId}/invite`}
                            onClick={() => setIsSidebarOpen(false)}
                            className={({ isActive }) => `
                                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                                transition-colors font-medium
                                ${isActive
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                }
                            `}
                        >
                            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                                />
                            </svg>
                            Invite member
                        </NavLink>
                    )}
                </nav>
                {/* Bottom section — user info + logout */}
                <div className="flex-shrink-0 border-t border-gray-200 p-4">

                    {/* User info row — click avatar OR name to go to account settings */}
                    <button
                        onClick={() => navigate('/settings')}
                        className="flex items-center gap-3 mb-3 w-full text-left hover:bg-gray-50 rounded-lg p-2 -mx-2 transition-colors group"
                        title="Account settings"
                    >
                        {/* 
                            Avatar circle — now uses getAvatarColor for consistency.
                            Clicking this navigates to /settings.
                            WHY THIS PATTERN: Every major app (Slack, Notion, Linear)
                            puts profile access on the avatar. Users intuitively click it.
                        */}
                        <div
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                            style={{ backgroundColor: avatarColor }}
                        >
                            {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                                {displayName}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                                {user?.email ?? ''}
                            </p>
                        </div>
                        {/* Settings gear icon — appears on hover */}
                        <svg
                            className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                            />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                        </svg>
                    </button>

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

                    <button
                        onClick={() => navigate('/settings')}
                        style={{ backgroundColor: avatarColor }}
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-opacity"
                        aria-label="Account settings"
                    >
                        <span className="text-xs font-semibold text-white">{initials}</span>
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