// src/api/axios.ts
//
// PURPOSE: Creates a single configured Axios instance that every part
//          of the app uses for HTTP requests. Never import raw axios
//          anywhere else — always import this instance instead.
//
// INPUTS:  None (this is a module-level singleton, not a function)
//
// OUTPUTS: A pre-configured Axios instance called `api`
//
// WHY THIS APPROACH:
//   - Single source of truth for the backend URL
//   - Token is attached automatically — no manual headers in components
//   - 401 handling is centralised — logout logic in one place
//   - Switching from localhost to production URL = change one line

import axios from 'axios'
// toast lives outside the React tree — react-hot-toast handles this correctly.
// It queues toasts until <Toaster /> mounts in App.tsx.
import toast from 'react-hot-toast'

// ─── 1. CREATE THE AXIOS INSTANCE ──────────────────────────────────────────

const api = axios.create({
    // baseURL is prepended to every request automatically.
    // api.get('/teams') becomes GET http://localhost:3001/api/teams
    //
    // WHY import.meta.env: Vite injects environment variables at build time.
    // In development: reads from .env.local
    // In production:  reads from the environment variables set on Vercel
    // This means we never hardcode 'http://localhost:3001' in production code.
    baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api',

    // timeout: if the backend doesn't respond in 10 seconds, Axios
    // automatically rejects the request with an error.
    // WHY: Prevents the UI from hanging forever if the backend is down.
    timeout: 10_000,

    headers: {
        // Tell the backend we are sending JSON.
        // Our backend's express.json() middleware reads this header
        // to know it should parse the request body as JSON.
        'Content-Type': 'application/json',
    },
})

// ─── 2. REQUEST INTERCEPTOR ────────────────────────────────────────────────
//
// Runs BEFORE every outgoing request.
// Job: attach the JWT token if one exists in localStorage.

api.interceptors.request.use(
    (config) => {
        // Read the token from localStorage.
        // localStorage persists across browser tabs and page refreshes.
        // WHY localStorage and not a cookie: Our backend uses JWT in the
        // Authorization header, not cookie-based sessions. localStorage is
        // the standard place for bearer tokens in SPA applications.
        const token = localStorage.getItem('cloudteams_token')

        if (token) {
            // Attach the token to the Authorization header.
            // The format "Bearer <token>" is the HTTP standard for JWT auth.
            // Our backend's authenticate middleware reads exactly this format:
            //   const token = req.headers.authorization?.split(' ')[1]
            config.headers.Authorization = `Bearer ${token}`
        }

        // MUST return config — Axios uses the returned config to send the request.
        // Returning nothing would cancel every request.
        return config
    },
    (error) => {
        // This branch handles errors that happen BEFORE the request is sent
        // (e.g., the request config itself is invalid).
        // We reject with the error to let the calling code handle it.
        return Promise.reject(error)
    }
)

// ─── 3. RESPONSE INTERCEPTOR ───────────────────────────────────────────────
//
// Runs AFTER every response arrives.
// Job: detect 401 Unauthorized and handle logout automatically.

api.interceptors.response.use(
    (response) => {
        // For any successful response (status 200-299),
        // just pass it through unchanged.
        // The calling component receives response.data as normal.
        return response
    },
    (error) => {
        // error.response exists when the server responded with an error status.
        // error.response is undefined for network errors (server unreachable).
        const status = error.response?.status

        if (status === 401) {
            // 401 means the token is missing, expired, or invalid.
            // The user must log in again.

            // Remove the invalid token — it's useless now.
            localStorage.removeItem('cloudteams_token')

            // Also remove any 2FA temp token if it exists.
            sessionStorage.removeItem('cloudteams_temp_token')

            // Hard redirect to login — clears React in-memory state too.
            // WHY window.location.href not navigate(): interceptor is outside React tree.
            // Only redirect if not already on login — prevents infinite redirect loop.
            if (window.location.pathname !== '/login') {
                window.location.href = '/login'
            }

            // ⚠️ DO NOT show a toast for 401 — the redirect IS the feedback.
            // Showing "Unauthorized" + redirect = double feedback, which is confusing.

            // ── Global error toast ────────────────────────────────────────────
            // For every non-401 error, show a red toast with the backend message.
            //
            // EXCEPTION: If the request config has skipGlobalToast: true, we 
            // do nothing here and let the calling component handle the error.
            if ((error.config as any)?.skipGlobalToast) {
                return Promise.reject(error)
            }

            const message: string =
                error.response?.data?.error     // backend error field (most common)
                ?? error.response?.data?.message  // some APIs use 'message' not 'error'
                ?? (error.response             // server responded but no readable body
                    ? `Request failed (${status})`
                    : 'Server unreachable — check your connection') // no response at all

            toast.error(message)
        }

        // MUST re-reject so React Query's error state and .catch() blocks
        // still receive the error. Without this, errors silently disappear.
        return Promise.reject(error)
    }
)

// ─── 4. EXPORT ─────────────────────────────────────────────────────────────

// Default export — import this as `api` everywhere:
//   import api from '@/api/axios'
//   api.get('/teams')
//   api.post('/auth/login', { email, password })
export default api