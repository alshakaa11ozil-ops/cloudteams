// src/components/ProtectedRoute.tsx
//
// PURPOSE: Guards any route that requires authentication.
//          Renders children only when the user is confirmed logged in.
//          Redirects to /login if not authenticated.
//          Shows nothing while auth state is still loading.
//
// INPUTS:  children — the page component to render if authenticated
// OUTPUTS: null (loading) | <Navigate to="/login"> | children
//
// USAGE in App.tsx:
//   <Route element={<ProtectedRoute />}>
//     <Route path="/teams" element={<TeamList />} />
//   </Route>

import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute() {
    // Read auth state from AuthContext via our useAuth hook.
    // isLoading: still reading localStorage
    // user: the logged-in user, or null
    const { user, isLoading } = useAuth()

    // ── State 1: Still loading ───────────────────────────────────────────────
    //
    // AuthProvider's useEffect hasn't finished reading localStorage yet.
    // We return null (renders nothing) to prevent a premature redirect.
    //
    // WHY null and not a spinner: At this stage the entire app is loading,
    // not just one component. A full-page spinner would flash for <50ms
    // and look worse than nothing. If loading takes longer (slow device),
    // we can add a spinner later.

    if (isLoading) {
        return null
    }

    // ── State 2: Not authenticated ───────────────────────────────────────────
    //
    // Loading is done and there's no user. Send them to /login.
    //
    // WHY <Navigate> and not window.location.href:
    // <Navigate> is React Router's way to redirect — it keeps the app
    // inside the SPA without a full page reload. window.location.href
    // would reload the entire React app unnecessarily.
    //
    // replace={true} means this redirect REPLACES the current history entry.
    // Without it, the browser back button would send the user back to the
    // protected page they just got bounced from — an infinite redirect loop.

    if (!user) {
        return <Navigate to="/login" replace />
    }

    // ── State 3: Authenticated ───────────────────────────────────────────────
    //
    // User is confirmed logged in. Render the child route.
    //
    // WHY <Outlet> and not {children}:
    // When ProtectedRoute is used as a layout route in React Router v6
    // (wrapping multiple child routes), React Router passes child routes
    // through <Outlet>, not through the children prop.
    // <Outlet> renders whichever child route matches the current URL.

    return <Outlet />
}