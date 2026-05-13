// frontend/src/api/socket.ts
//
// PURPOSE: Single shared Socket.io client instance for the whole app.
//
// WHY ONE INSTANCE: Multiple components need socket access (FileBrowser
//   for file events, lock events already wired in Week 8).
//   One import = one WebSocket connection. Importing this file from
//   multiple places returns the SAME object — Node module caching.
//
// autoConnect: false — we call socket.connect() manually inside
//   FileBrowser's useEffect so it only connects when needed,
//   and we can cleanly disconnect on unmount.

import { io } from 'socket.io-client'

const BACKEND_URL = (import.meta.env.VITE_API_URL as string | undefined)
    ?.replace('/api', '')
    ?? 'http://localhost:3001'

const socket = io(BACKEND_URL, {
    autoConnect: false,      // connect manually inside useEffect
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
})

export default socket