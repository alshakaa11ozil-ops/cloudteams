// PURPOSE: Database connection using Prisma (replaces Sequelize)
// WHY PRISMA OVER SEQUELIZE: Prisma generates a fully-typed client
//   from your schema. Every query has autocomplete and type checking.
//   Sequelize gives you 'any' types everywhere, which defeats TypeScript.
// WHY SINGLETON: One shared instance = one connection pool.
//   Multiple instances = too many DB connections = PostgreSQL errors.


import { PrismaClient } from '../generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'

// Load .env so DATABASE_URL is available
dotenv.config()

// Create the PostgreSQL connection adapter
// WHY: Prisma 7 separates "how to connect" (adapter) from
//   "how to query" (PrismaClient). The adapter handles the
//   raw TCP connection to PostgreSQL.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
})

// Create the Prisma client, passing the adapter
// WHY adapter here: Prisma 7 "client" engine requires this.
//   It replaces the old built-in connection from Prisma 5/6.
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']
    : ['error'],
})

// ============================================================
// testConnection()
// PURPOSE: Verify the database is reachable when server starts
// ============================================================
export const testConnection = async (): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`
    console.log('✅ Database connected successfully (Prisma 7)')
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    process.exit(1)
  }
}

export default prisma