import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client.js';
import { env } from './env.js';
const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL });
export const prisma = new PrismaClient({
    adapter,
    log: env.isProd ? ['error'] : ['error', 'warn'],
});
export async function tuneDatabase(): Promise<void> {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;');
    await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL;');
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000;');
}
