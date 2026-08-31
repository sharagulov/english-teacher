import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(backendRoot, '.env') });
const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().min(1).default('file:./prisma/dev.db'),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default('0.0.0.0'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET должен быть не короче 16 символов'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_BASE_URL: z.string().optional(),
    AI_USD_RUB_RATE: z.coerce.number().positive().default(95),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('\n✖ Некорректная конфигурация окружения (backend/.env):\n');
    for (const issue of parsed.error.issues) {
        console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nСкопируйте .env.example в backend/.env и заполните значения.\n');
    process.exit(1);
}
export const env = {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    isProd: parsed.data.NODE_ENV === 'production',
    aiEnabled: parsed.data.OPENAI_API_KEY.trim().length > 0,
};
