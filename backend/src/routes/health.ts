// PURPOSE: Health check endpoint — verifies server AND database are alive
// WHY THIS EXISTS: Deployment platforms (Railway, Vercel) ping this endpoint
//   to know if the service is healthy. Also lets you manually confirm
//   your setup is working correctly right now.

import { Router, Request, Response } from 'express';
import prisma from '../config/database';

const router = Router();

// GET /api/health
// Returns 200 if server + database are both working
// Returns 503 if database is unreachable
router.get('/', async (req: Request, res: Response) => {
  try {
    // Send the simplest possible query to verify DB connectivity
    // WHY $queryRaw: Prisma's equivalent of Sequelize's .authenticate()
    // 'SELECT 1' just asks PostgreSQL "are you there?" — no tables needed
    await prisma.$queryRaw`SELECT 1`

    // 200 = everything is healthy
    res.status(200).json({
      status: 'healthy',
      message: 'CloudTeams API is running',
      database: 'connected (Prisma)',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    });

  } catch (error) {
    // 503 = Service Unavailable — server is up but DB is down
    res.status(503).json({
      status: 'unhealthy',
      message: 'Database connection failed',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;