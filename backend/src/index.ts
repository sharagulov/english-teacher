import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { prisma, tuneDatabase } from './db.js';
import { env } from './env.js';
import authPlugin from './plugins/auth.js';
import aiRoutes from './routes/ai.js';
import authRoutes from './routes/auth.js';
import practiceRoutes from './routes/practice.js';
import rewardRoutes from './routes/rewards.js';
import statsRoutes from './routes/stats.js';
import wordRoutes from './routes/words.js';
import { ATTRIBUTION } from './lib/sources.js';
import { warmupExamples } from './services/examples.js';
const app = Fastify({
    logger: env.isProd
        ? { level: 'info' }
        : {
            level: 'info',
            transport: undefined,
            serializers: {
                req: (request) => ({ method: request.method, url: request.url }),
                res: (reply) => ({ statusCode: reply.statusCode }),
            },
        },
    bodyLimit: 1024 * 512,
});
app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & {
        statusCode?: number;
        code?: string;
    };
    if (error instanceof ZodError) {
        const issue = error.issues[0];
        const where = issue?.path.join('.') ?? '';
        return reply.code(400).send({
            error: where ? `Некорректное значение «${where}»: ${issue?.message}` : (issue?.message ?? 'Некорректный запрос'),
        });
    }
    if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'Запись не найдена' });
    }
    if (typeof error.statusCode !== 'number') {
        request.log.error({ err: error }, 'Необработанная ошибка запроса');
        return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
    }
    if (error.statusCode >= 500) {
        request.log.warn({ err: error }, 'Сервис недоступен');
    }
    return reply.code(error.statusCode).send({ error: error.message });
});
const clientDir = path.resolve(process.cwd(), '../frontend/dist');
const serveClient = existsSync(path.join(clientDir, 'index.html'));
if (serveClient) {
    await app.register(fastifyStatic, { root: clientDir, wildcard: false });
}
app.setNotFoundHandler((request, reply) => {
    if (serveClient && request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Метод не найден' });
});
await app.register(cors, {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
    credentials: true,
});
await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: 'Слишком много запросов, подождите немного' }),
});
await app.register(authPlugin);
app.get('/api/health', async () => ({
    status: 'ok',
    aiEnabled: env.aiEnabled,
    words: await prisma.word.count({ where: { ownerId: null } }),
    attribution: ATTRIBUTION,
}));
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(practiceRoutes, { prefix: '/api/practice' });
await app.register(wordRoutes, { prefix: '/api/words' });
await app.register(statsRoutes, { prefix: '/api/stats' });
await app.register(rewardRoutes, { prefix: '/api/rewards' });
await app.register(aiRoutes, { prefix: '/api/ai' });
const shutdown = async (signal: string) => {
    app.log.info(`Получен ${signal}, останавливаю сервер`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
try {
    await tuneDatabase();
    const wordCount = await prisma.word.count({ where: { ownerId: null } });
    if (wordCount === 0) {
        app.log.warn('Словарь пуст. Запустите: npm run db:import --workspace backend');
    }
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Словарь: ${wordCount} слов. ИИ-функции: ${env.aiEnabled ? 'включены' : 'выключены (нет OPENAI_API_KEY)'}`);
    warmupExamples((message) => app.log.info(message));
}
catch (error) {
    app.log.error(error);
    process.exit(1);
}
