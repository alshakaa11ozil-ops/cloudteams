// src/context/AuthContext.tsx
//
// PURPOSE: Creates and provides global authentication state to the entire app.
//          Any component can read the current user and call login/logout
//          without prop drilling.
//
// WHY CONTEXT: Auth state is needed by almost every page. Passing it as props
//              through Layout → Page → Component → SubComponent is impractical.
//              Context is React's built-in solution for "global" state.

import { createContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type { User } from '@/types'

// ─── 1. DEFINE WHAT THE CONTEXT HOLDS ─────────────────────────────────────
//
// This interface describes the exact shape of the value every consumer
// of this context will receive when they call useAuth().

interface AuthContextValue {
    user: User | null           // The logged-in user, or null if not logged in
    token: string | null        // The JWT token stored in localStorage
    isLoading: boolean          // True only during the initial localStorage check
    // Prevents the app from flashing /login before
    // it has finished reading the stored token
    login: (token: string, user: User) => void   // Call this after successful login
    updateUser: (newUser: User) => void          // Call this to update user data without re-logging
    refreshUser: () => Promise<void>             // Call this to fetch fresh user data from backend
    logout: () => void                            // Call this to log out
}

// ─── 2. CREATE THE CONTEXT ─────────────────────────────────────────────────
//
// createContext() creates the actual context object.
// The argument is the DEFAULT value — used only if a component tries to read
// the context WITHOUT being wrapped in our AuthProvider.
// We set it to undefined and handle that case in useAuth() (see file 2).
//
// WHY undefined default: If we provided a fake default value, bugs where
// AuthProvider is missing would silently produce wrong behaviour.
// undefined forces an immediate, obvious error instead.

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ─── 3. THE PROVIDER COMPONENT ─────────────────────────────────────────────
//
// PURPOSE: Wraps the entire app. Holds the auth state in useState.
//          Makes that state available to every child component.
//
// INPUTS:  children — everything rendered inside <AuthProvider>...</AuthProvider>
// OUTPUTS: Renders children, providing auth state to all of them

interface AuthProviderProps {
    children: ReactNode   // ReactNode = anything React can render (JSX, strings, arrays)
}

export function AuthProvider({ children }: AuthProviderProps) {

    // ── State ────────────────────────────────────────────────────────────────

    const [user, setUser] = useState<User | null>(null)
    const [token, setToken] = useState<string | null>(null)

    // isLoading starts TRUE because on first render we haven't yet checked
    // localStorage. While true, ProtectedRoute shows nothing (no flicker).
    const [isLoading, setIsLoading] = useState(true)

    // ── Effect: Read stored auth from localStorage on app start ─────────────
    //
    // WHY useEffect here: localStorage is a browser API — it can't be read
    // during server-side rendering (if we ever add SSR). useEffect runs only
    // in the browser, after the component mounts. This is the correct place.
    //
    // This runs ONCE when the app first loads (empty dependency array []).
    // It checks if the user was already logged in from a previous session.

    useEffect(() => {
        const storedToken = localStorage.getItem('cloudteams_token')
        const storedUser = localStorage.getItem('cloudteams_user')

        if (storedToken && storedUser) {
            try {
                // storedUser is a JSON string — parse it back to an object.
                // WHY try/catch: if localStorage has corrupted data (e.g. partially
                // written), JSON.parse throws. We catch it and treat as logged-out
                // rather than crashing the entire app.
                const parsedUser: User = JSON.parse(storedUser)
                setToken(storedToken)
                setUser(parsedUser)
            } catch {
                // Corrupted data — clear it and start fresh
                localStorage.removeItem('cloudteams_token')
                localStorage.removeItem('cloudteams_user')
            }
        }

        // Whether we found a token or not, loading is done.
        // ProtectedRoute can now make its decision.
        setIsLoading(false)
    }, [])  // [] = run once on mount only

    // ── login() ──────────────────────────────────────────────────────────────
    //
    // PURPOSE: Called by Login.tsx after the backend returns a token + user.
    //          Saves to both localStorage (persists across refreshes) and
    //          React state (makes it available to components immediately).
    //
    // WHY useCallback: Prevents this function from being recreated on every
    // render. Without useCallback, any component that receives login as a prop
    // or dependency would re-render unnecessarily whenever AuthProvider renders.
    // It's a performance optimisation — not strictly required, but correct practice.

    const login = useCallback((newToken: string, newUser: User) => {
        // Save to localStorage so the session survives page refresh
        localStorage.setItem('cloudteams_token', newToken)
        // Store user as JSON string — localStorage only holds strings
        localStorage.setItem('cloudteams_user', JSON.stringify(newUser))

        // Update React state so components re-render with the new user immediately
        setToken(newToken)
        setUser(newUser)
    }, [])

    // ── updateUser() ──────────────────────────────────────────────────────────
    //
    // PURPOSE: Update user data in both localStorage and React state without
    //          requiring a full login (e.g. after profile update).
    
    const updateUser = useCallback((newUser: User) => {
        localStorage.setItem('cloudteams_user', JSON.stringify(newUser))
        setUser(newUser)
    }, [])

    // ── logout() ─────────────────────────────────────────────────────────────
    //
    // PURPOSE: Clears all auth data and sends the user to /login.
    //          Called by: the logout button in Layout, and the 401 interceptor
    //          in axios.ts for expired tokens.

    const logout = useCallback(() => {
        // Clear localStorage — next page load will find nothing
        localStorage.removeItem('cloudteams_token')
        localStorage.removeItem('cloudteams_user')
        sessionStorage.removeItem('cloudteams_temp_token')  // 2FA cleanup

        // Clear React state — components re-render showing logged-out UI
        setToken(null)
        setUser(null)

        // Hard redirect to login.
        // WHY window.location and not navigate(): logout() is defined outside
        // React Router's component tree, so navigate() isn't available here.
        // window.location.href also clears all React in-memory state cleanly.
        window.location.href = '/login'
    }, [])

    const refreshUser = useCallback(async () => {
        try {
            // Import api lazily same pattern as logout uses
            const { default: api } = await import('@/api/axios')
            const res = await api.get<{ user: User }>('/auth/me')
            // Update the user in state — all components using useAuth() re-render
            setUser(res.data.user)
            // Also update localStorage so refresh persists
            localStorage.setItem('cloudteams_user', JSON.stringify(res.data.user))
        } catch {
            // If /me fails (token expired etc.), log out cleanly
            logout()
        }
    }, [logout])

    // ── Provide the value ─────────────────────────────────────────────────────
    //
    // Every component wrapped by <AuthProvider> can now call useAuth()
    // and receive exactly this object.

    const value: AuthContextValue = {
        user,
        token,
        isLoading,
        login,
        updateUser,
        refreshUser,
        logout,
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}