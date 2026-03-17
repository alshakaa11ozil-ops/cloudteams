// PURPOSE: Create a single shared Prisma client instance for the entire app
// WHY SINGLETON: If we create a new PrismaClient() in every file, we get
// too many database connections and performance problems.
// This file creates ONE instance and exports it everywhere.

import { PrismaClient } from '../generated/prisma'

// Create the single Prisma client instance
const prisma = new PrismaClient({
  log: ['error', 'warn'], // Log errors and warnings to console
})

// Export the single instance — every file imports from here
export default prisma