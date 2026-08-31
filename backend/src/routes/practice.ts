import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { MODE_LABELS, MODE_UNLOCK_LEVEL, PRACTICE_MODES, choiceHintCost, } from '../lib/economy.js';
import { CEFR_LEVELS, isCefrLevel, levelsUpTo } from '../lib/levels.js';
import { abandonPool, buyChoiceHint, countAvailable, createPool, getActivePool, getPoolState, submitAnswer, undoLastWrongAnswer } from '../services/practice.js';
const overviewQuery = z.object({
    levels: z
        .string()
        .optional()
        .transform((raw) => {
        if (!raw?.trim())
            return undefined;
        const levels = raw.split(',').map((part) => part.trim()).filter(isCefrLevel);
        return levels.length > 0 ? levels : undefined;
    }),
    topics: z
        .string()
        .optional()
        .transform((raw) => {
        if (!raw?.trim())
            return undefined;
        const topics = raw.split(',').map((part) => part.trim()).filter(Boolean);
        return topics.length > 0 ? topics : undefined;
    }),
});
const poolBody = z.object({
    mode: z.enum(PRACTICE_MODES).default('classic'),
    size: z.number().int().min(5).max(50).default(20),
    levels: z.array(z.enum(CEFR_LEVELS)).optional(),
    topics: z.array(z.string().min(1).max(80)).max(20).optional(),
    partsOfSpeech: z.array(z.string().min(1).max(30)).max(10).optional(),
    direction: z.enum(['en_ru', 'ru_en']).optional(),
});
const answerBody = z.object({
    wordId: z.number().int().positive(),
    answer: z.string().max(200),
    responseMs: z.number().int().min(0).max(600000).default(0),
    hintsUsed: z.number().int().min(0).max(4).default(0),
    gaveUp: z.boolean().optional(),
});
const undoBody = z.object({
    wordId: z.number().int().positive(),
});
const practiceRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', app.authenticate);
    app.get('/overview', async (request) => {
        const user = await prisma.user.findUniqueOrThrow({
            where: { id: request.userId },
            select: { cefrLevel: true, level: true, points: true },
        });
        const parsed = overviewQuery.safeParse(request.query);
        const defaultLevels = levelsUpTo(user.cefrLevel);
        const countLevels = parsed.success && parsed.data.levels?.length ? parsed.data.levels : defaultLevels;
        const countFilters = parsed.success && parsed.data.topics ? { topics: parsed.data.topics } : {};
        const availability = await countAvailable(request.userId, countLevels, countFilters);
        const topics = await prisma.word.groupBy({
            by: ['topic'],
            where: { ownerId: null, isFunctionWord: false, topic: { not: null } },
            _count: true,
            orderBy: { _count: { topic: 'desc' } },
        });
        return {
            levels: defaultLevels,
            availability,
            activePool: await getActivePool(request.userId),
            modes: PRACTICE_MODES.map((mode) => ({
                mode,
                label: MODE_LABELS[mode],
                unlockLevel: MODE_UNLOCK_LEVEL[mode],
                unlocked: user.level >= MODE_UNLOCK_LEVEL[mode],
            })),
            topics: topics.map((t) => ({ topic: t.topic as string, count: t._count })),
            choiceHint: {
                cost: choiceHintCost(user.points),
                description: 'В режиме «Выбор варианта» можно убрать два неверных варианта за рейтинг.',
            },
        };
    });
    app.post('/pools', async (request, reply) => {
        const parsed = poolBody.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Некорректные параметры пулла' });
        }
        const { mode, size, direction, ...filters } = parsed.data;
        const user = await prisma.user.findUniqueOrThrow({
            where: { id: request.userId },
            select: { level: true },
        });
        const required = MODE_UNLOCK_LEVEL[mode];
        if (user.level < required) {
            return reply.code(403).send({ error: `Режим откроется на ${required} уровне` });
        }
        const state = await createPool({
            userId: request.userId,
            mode,
            size,
            filters: {
                levels: filters.levels,
                topics: filters.topics,
                partsOfSpeech: filters.partsOfSpeech,
                ...(mode === 'classic' && direction === 'ru_en' ? { direction: 'ru_en' as const } : {}),
            },
        });
        return reply.code(201).send(state);
    });
    app.get('/pools/active', async (request) => {
        return { state: await getActivePool(request.userId) };
    });
    app.get('/pools/:id', async (request) => {
        const { id } = request.params as {
            id: string;
        };
        return getPoolState(request.userId, id);
    });
    app.post('/pools/:id/answer', async (request, reply) => {
        const { id } = request.params as {
            id: string;
        };
        const parsed = answerBody.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Некорректный ответ' });
        }
        const result = await submitAnswer({ userId: request.userId, poolId: id, ...parsed.data });
        const state = await getPoolState(request.userId, id);
        return { result, state };
    });
    app.post('/pools/:id/choice-hint', async (request, reply) => {
        const { id } = request.params as {
            id: string;
        };
        const parsed = undoBody.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Некорректный запрос подсказки' });
        }
        try {
            return await buyChoiceHint(request.userId, id, parsed.data.wordId);
        }
        catch (cause) {
            const statusCode = cause && typeof cause === 'object' && 'statusCode' in cause ? Number(cause.statusCode) : 500;
            const message = cause instanceof Error ? cause.message : 'Не удалось взять подсказку';
            return reply.code(statusCode).send({ error: message });
        }
    });
    app.post('/pools/:id/undo', async (request, reply) => {
        const { id } = request.params as {
            id: string;
        };
        const parsed = undoBody.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Некорректный запрос отмены' });
        }
        try {
            const { state, undo } = await undoLastWrongAnswer(request.userId, id, parsed.data.wordId);
            return { state, undo };
        }
        catch (cause) {
            const statusCode = cause && typeof cause === 'object' && 'statusCode' in cause ? Number(cause.statusCode) : 500;
            const message = cause instanceof Error ? cause.message : 'Не удалось отменить ответ';
            return reply.code(statusCode).send({ error: message });
        }
    });
    app.post('/pools/:id/abandon', async (request) => {
        const { id } = request.params as {
            id: string;
        };
        await abandonPool(request.userId, id);
        return { ok: true };
    });
};
export default practiceRoutes;
