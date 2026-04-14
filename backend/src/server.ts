// PURPOSE: Initialize Express, register all middleware & routes,
//   test the database connection, and start listening for requests.
//   Also initializes Socket.io for real-time lock events and
//   starts the cron job for auto-expiring stale leases.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
// WHY http.createServer instead of app.listen:
//   Socket.io must attach to the raw Node.js HTTP server, not the
//   Express app. We create the server manually so we can pass it
//   to both Express AND Socket.io. Same port, two handlers.

import { testConnection } from './config/database';
import { initSocket } from './socket';
import { startCronJobs } from './cron';

// Routes
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import teamRoutes from './routes/teamRoutes';
import lockRoutes from './routes/lock.routes';
import fileRoutes from './routes/fileRoutes';
import folderRoutes from './routes/folderRoutes';
import searchRoutes from './routes/searchRoutes';
import recycleBinRoutes from './routes/recycleBinRoutes';
import commentRoutes from './routes/commentRoutes';
import versionRoutes from './routes/versionRoutes';
import shareRoutes from './routes/shareRoutes';

// Load .env values into process.env — must run before anything
// reads process.env variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================
// SECURITY MIDDLEWARE
// Runs on every request before any route handler.
// ============================================================

// Sets 11 HTTP security headers automatically.
// Prevents clickjacking, MIME sniffing, and more.
app.use(helmet());

// Allows our React frontend (port 5173) to call this backend.
// Browsers block cross-origin requests by default.
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Rate limiter — applied to auth routes only.
// Limits each IP to 10 login attempts per 15 minutes.
// Prevents brute-force password attacks.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Parse JSON bodies into req.body.
// Without this, req.body is undefined on POST/PATCH requests.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// ROUTES
// Order matters — more specific paths must come before wildcards.
// ============================================================

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/teams/:teamId/files/:fileId', lockRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/search', searchRoutes);

// Lock routes — mounted under the file-level path.
// :teamId and :fileId are available inside lock.routes.ts
// because we set mergeParams: true in that router.


app.use('/api/teams', recycleBinRoutes);
app.use('/api/teams', commentRoutes);
app.use('/api/teams', versionRoutes);
app.use('/api/share', shareRoutes);

// Catch-all 404 — returns clean JSON instead of Express HTML page.
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} does not exist`,
  });
});

// ============================================================
// startServer
// PURPOSE:  Verify DB is reachable, create the HTTP server,
//           attach Socket.io, start cron jobs, then listen.
// WHY THIS ORDER:
//   1. Test DB first — a server without a DB is broken.
//   2. Create http.Server from Express app.
//   3. initSocket(httpServer) — must happen before listen()
//      so Socket.io is ready when first client connects.
//   4. startCronJobs() — starts the background scheduler.
//   5. httpServer.listen() — start accepting connections.
// ============================================================
const startServer = async () => {
  // Step 1: Verify Prisma can reach PostgreSQL.
  // Exits the process if the DB is unreachable.
  await testConnection();

  // Step 2: Create the raw HTTP server from the Express app.
  // This is what Socket.io attaches to.
  const httpServer = http.createServer(app);

  // Step 3: Attach Socket.io to the HTTP server.
  // After this line, WebSocket connections are accepted on the
  // same port as HTTP — no second port needed.
  initSocket(httpServer);

  // Step 4: Start the cron job scheduler.
  // Registers the stale lease cleanup job (runs every 30 min).
  startCronJobs();

  // Step 5: Start listening for connections.
  // WHY httpServer.listen (not app.listen):
  //   app.listen creates its OWN internal http.Server which
  //   Socket.io does not know about. We must listen on the
  //   same httpServer we passed to initSocket().
  httpServer.listen(PORT, () => {
    console.log(`🚀 CloudTeams API running on http://localhost:${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔌 Socket.io ready for real-time connections`);
    console.log(`⏰ Cron jobs active`);
  });
};

startServer();

export default app;