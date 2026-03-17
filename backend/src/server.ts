// PURPOSE: Initialize Express, register all middleware & routes,
//   test the database connection, and start listening for requests
// WHY EXPRESS: Express handles HTTP routing with minimal boilerplate.
// WHY NO sequelize.sync(): Prisma uses migrations (prisma migrate dev)
//   to manage the schema. We never auto-sync from code — migrations
//   are safer, explicit, and repeatable.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import our Prisma-based database connection
// WHY: testConnection() verifies DB is reachable before accepting requests
import { testConnection } from './config/database';

// Routes
import healthRouter from './routes/health';

// Load .env file values into process.env
// WHY FIRST: Must run before anything reads process.env variables
dotenv.config();

// Create the Express application instance
const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================
// MIDDLEWARE — runs on every request before route handlers
// Think of middleware as an assembly line for every HTTP request
// ============================================================

// cors() — allows your React frontend (port 5173) to call this
// backend (port 3001). Browsers block cross-origin requests by
// default — this explicitly allows our frontend origin.
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true, // Allow cookies and Authorization headers
}));

// Parse incoming JSON bodies into req.body
// WHY: Without this, req.body is undefined on POST/PUT requests
app.use(express.json());

// Parse form-encoded bodies (fallback for non-JSON requests)
app.use(express.urlencoded({ extended: true }));

// ============================================================
// ROUTES
// ============================================================

// Health check — GET /api/health
app.use('/api/health', healthRouter);

// Catch-all for any route that doesn't exist
// WHY: Returns clean JSON instead of Express's default HTML 404 page
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} does not exist`,
  });
});

// ============================================================
// startServer()
// PURPOSE: Verify DB is reachable, then start the HTTP server
// WHY ASYNC: DB test is async — we must await it before
//   accepting any requests. A server without a DB is broken.
// ============================================================
const startServer = async () => {
  // Step 1: Verify Prisma can reach PostgreSQL
  // If this fails, the process exits immediately with a clear error
  await testConnection();

  // Step 2: Start listening for HTTP requests
  // WHY NO sync(): Prisma uses migrations — schema is managed
  //   by 'npx prisma migrate dev', not by application code.
  //   This is safer and more explicit than Sequelize's auto-sync.
  app.listen(PORT, () => {
    console.log(`🚀 CloudTeams API running on http://localhost:${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  });
};

// Start the server
startServer();

export default app;