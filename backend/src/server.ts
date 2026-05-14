// PURPOSE: Initialize Express, register all middleware & routes,
//   test the database connection, and start listening for requests.
//   Also initializes Socket.io for real-time lock events and
//   starts the cron job for auto-expiring stale leases.
//
// WHY http.createServer instead of app.listen:
//   Socket.io AND Hocuspocus must attach to the raw Node.js HTTP server.
//   Same port, three handlers: Express (HTTP), Socket.io (WS /socket.io),
//   Hocuspocus (WS /collaboration).
//
// HOW WEBSOCKET ROUTING WORKS:
//   Browser sends HTTP Upgrade → httpServer fires 'upgrade' event:
//     /collaboration → wss.handleUpgrade → wire to Hocuspocus ClientConnection
//     /socket.io     → Socket.io handles automatically
//
// CRITICAL — Hocuspocus v4.0.0 handleConnection():
//   handleConnection(ws, request) returns a ClientConnection but does NOT
//   attach any WebSocket listeners internally. The caller MUST:
//     ws.on('message', ...) → conn.handleMessage(data)
//     ws.on('close', ...)   → conn.handleClose(event)
//   Without this, messages (auth, sync, updates) are never delivered.
//
// CRITICAL: destroyUpgrade: false in Socket.io config (set in socket.ts).
//   Without this, Socket.io destroys every upgrade it doesn't recognise.

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import http from 'http'
import { WebSocketServer } from 'ws'

import { testConnection } from './config/database'
import { initSocket } from './socket'
import { startCronJobs } from './cron'
import collabServer from './collaboration/hocuspocus'

// Routes
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import teamRoutes from './routes/teamRoutes'
import lockRoutes from './routes/lock.routes'
import fileRoutes from './routes/fileRoutes'
import folderRoutes from './routes/folderRoutes'
import searchRoutes from './routes/searchRoutes'
import recycleBinRoutes from './routes/recycleBinRoutes'
import commentRoutes from './routes/commentRoutes'
import versionRoutes from './routes/versionRoutes'
import shareRoutes from './routes/shareRoutes'
import digestRouter from './routes/digestRoutes'
import editorAssistRoutes from './routes/editorAssistRoutes'
import documentRoutes from './routes/documentRoutes'

dotenv.config()

const app = express()
// WHY trust proxy: Railway sits behind a load balancer that sets
// X-Forwarded-For. Without this, express-rate-limit throws an error
// because it can't trust the IP header. '1' means trust one proxy hop.

app.set('trust proxy', 1)
// ============================================================
// SECURITY MIDDLEWARE
// ============================================================

app.use(helmet())

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, health checks)
    if (!origin) return callback(null, true);

    const allowed = [
      process.env.FRONTEND_URL,          // https://cloudteams.vercel.app
      'http://localhost:5173',            // local dev
      'http://localhost:3000',            // alternative local
    ].filter(Boolean) as string[];

    // Also allow ANY vercel.app preview URL for this project
    const isVercelPreview = origin.endsWith('.vercel.app');

    if (allowed.includes(origin) || isVercelPreview) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}))

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ============================================================
// ROUTES
// ============================================================

app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/teams/:teamId/files/:fileId', lockRoutes)
app.use('/api/teams', teamRoutes)
app.use('/api/files', fileRoutes)
app.use('/api/folders', folderRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/teams', recycleBinRoutes)
app.use('/api/teams', commentRoutes)
app.use('/api/teams', versionRoutes)
app.use('/api/share', shareRoutes)
app.use('/api', digestRouter)
app.use('/api', editorAssistRoutes)
app.use('/api/teams/:teamId/documents', documentRoutes)

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} does not exist`,
  })
})

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large. Maximum size is 50MB.' })
  } else {
    console.error('[Global Error]', err)
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' })
  }
})

// ============================================================
// startServer
// ============================================================
const startServer = async () => {
  // Step 1: Verify DB connection — fail fast if DB is unreachable
  await testConnection()
  // server.ts — use PORT env var
  const PORT = process.env.PORT || 3001; // Railway sets PORT automatically

  // Step 2: Create raw HTTP server from Express app
  const httpServer = http.createServer(app)

  // Step 3: Attach Socket.io FIRST.
  //
  // WHY FIRST: Socket.io registers its own 'upgrade' listener on httpServer.
  // We pass destroyUpgrade: false (set in socket.ts) so it does NOT destroy
  // unknown upgrade requests. Unknown upgrades (/collaboration) fall through
  // to our listener in Step 5.
  initSocket(httpServer)

  // Step 4: Start background cron jobs (lock expiry, digest emails, etc.)
  startCronJobs()

  // Step 5: Wire Hocuspocus onto the same HTTP server — single-port mode.
  //
  // HOW IT WORKS:
  //   1. WebSocketServer({ noServer: true }) — doesn't listen on its own port,
  //      only completes handshakes for connections we explicitly hand to it.
  //   2. On /collaboration upgrade: wss.handleUpgrade() sends 101 back to
  //      browser, gives us an established `ws` WebSocket object.
  //   3. collabServer.handleConnection(ws, request) returns a ClientConnection.
  //   4. We MUST wire ws.on('message') → conn.handleMessage() and
  //      ws.on('close') → conn.handleClose() because Hocuspocus v4.0.0
  //      does NOT attach any listeners internally.

  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url ?? ''

    // Only handle Hocuspocus collaboration upgrades here.
    // Socket.io already registered its own listener for /socket.io upgrades
    // when initSocket(httpServer) was called above.
    if (!url.startsWith('/collaboration')) {
      // Don't destroy — Socket.io's listener handles /socket.io.
      // Any other unknown path just falls through (browser will timeout).
      return
    }

    console.log(`[WS] Upgrade request: ${url}`)

    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log('[WS] Handshake complete — wiring to Hocuspocus')

      // Convert Node.js IncomingMessage → web Request.
      // Hocuspocus v4.0.0 handleConnection() expects the web Fetch API
      // Request type, not http.IncomingMessage.
      const protocol = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
      const host = request.headers.host ?? `localhost:${PORT}`
      const webRequest = new Request(`${protocol}://${host}${request.url}`, {
        method: request.method,
        headers: new Headers(request.headers as Record<string, string>),
      })

      // CRITICAL: handleConnection() returns a ClientConnection but does
      // NOT attach any WebSocket listeners internally. The caller MUST
      // forward messages and close events manually.
      //
      // Without this wiring, every message from HocuspocusProvider
      // (auth token, sync steps, document updates) goes into the void.
      // That's why onAuthenticate never fired and store() never ran.
      const conn = collabServer.handleConnection(ws, webRequest)

      ws.on('message', (data: ArrayBuffer | Buffer) => {
        conn.handleMessage(new Uint8Array(data as ArrayBuffer))
      })

      ws.on('close', (code: number, reason: Buffer) => {
        conn.handleClose({ code, reason: reason?.toString() ?? '', wasClean: code === 1000 } as any)
      })
    })
  })

  // Step 6: Start listening
  httpServer.listen(PORT, () => {
    console.log(`🚀 CloudTeams API: http://localhost:${PORT}`)
    console.log(`🏥 Health check:   http://localhost:${PORT}/api/health`)
    console.log(`🔌 Socket.io:      ws://localhost:${PORT}/socket.io`)
    console.log(`📝 Hocuspocus:     ws://localhost:${PORT}/collaboration`)
    console.log(`   → VITE_WS_URL should be: ws://localhost:${PORT}`)
    console.log(`⏰ Cron jobs active`)
  })
}

startServer()

export default app
