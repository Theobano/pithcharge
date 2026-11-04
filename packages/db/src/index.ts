import { PrismaClient, Prisma } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg'

// Configuration comes from the process environment (each app loads its own .env).
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Define it in the running app\'s environment (apps/bff/.env or apps/worker/.env).');
}

const adapter = new PrismaPg({ connectionString })

const globalForDb = globalThis as unknown as {
  db:PrismaClient;
};

const db = globalForDb.db ?? new PrismaClient({adapter});

if (process.env.NODE_ENV !== 'production') {
  globalForDb.db = db;
}

export default db
export {db}
export { Prisma, PrismaClient } from './generated/prisma/client.js';