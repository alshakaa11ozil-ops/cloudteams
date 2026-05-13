// src/main.tsx
// PURPOSE: The entry point of the entire React app.
// This is the ONE file that "mounts" React onto the HTML page.
// React finds the <div id="root"> in index.html and takes control of it.

// WHY StrictMode: React.StrictMode runs every component twice in development
// to help you find bugs early (like effects that run twice, missing cleanup).
// It has NO effect in production — it's a developer safety net.
// src/main.tsx
// PURPOSE: App entry point. Wraps the entire component tree with providers.
//
// PROVIDER ORDER MATTERS — outer providers are available to inner ones:
//   QueryClientProvider  → makes React Query available everywhere
//     AuthProvider       → makes auth state available everywhere
//       App              → the actual router and pages

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import App from './App.tsx'
import './index.css'

// Create the React Query client.
// This is the cache that React Query uses for all server state.
// One instance for the entire app — created outside the component
// so it's never recreated on re-render.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // If a query fails, retry once automatically before showing an error.
      // WHY 1 not 3: On a bad network, retrying 3 times adds 6+ seconds of
      // delay before the user sees an error message. 1 retry is a good balance.
      retry: 1,

      // Data is considered fresh for 30 seconds.
      // Within this window, React Query won't refetch even if the component
      // remounts. After 30s, a background refetch happens automatically.
      staleTime: 30_000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)