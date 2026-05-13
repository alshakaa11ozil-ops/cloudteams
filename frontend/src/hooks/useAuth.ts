// src/hooks/useAuth.ts
//
// PURPOSE: A clean, safe hook for consuming AuthContext.
//          Instead of importing AuthContext and useContext everywhere,
//          every component just calls: const { user, login, logout } = useAuth()
//
// WHY A SEPARATE HOOK FILE:
//   1. Hides the useContext(AuthContext) boilerplate
//   2. Adds a safety check — throws a clear error if used outside AuthProvider
//   3. Components import one thing: useAuth, not two: useContext + AuthContext

import { useContext } from 'react'
import { AuthContext } from '../context/AuthContext'

export function useAuth() {
    const context = useContext(AuthContext)

    // Safety check: if context is undefined, the component calling useAuth()
    // is NOT wrapped inside <AuthProvider>.
    // WHY THIS MATTERS: Without this check, you'd get a confusing error like
    // "Cannot read properties of undefined (reading 'user')".
    // With this check, you get a clear message pointing to the real problem.
    if (context === undefined) {
        throw new Error('useAuth() must be used inside <AuthProvider>. Check that AuthProvider wraps your component tree in main.tsx.')
    }

    return context
}