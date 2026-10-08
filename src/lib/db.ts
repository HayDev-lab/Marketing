import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Reuse one connection pool per process, including production route bundles.
export const db = globalForPrisma.prisma ?? new PrismaClient()
globalForPrisma.prisma = db
