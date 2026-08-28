import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  HINT_KINDS,
  HINT_LABELS,
  HINT_REWARD_FACTOR,
  MODE_LABELS,
  MODE_UNLOCK_LEVEL,
  PRACTICE_MODES,
} from '../lib/economy.js';
import { CEFR_LEVELS, levelsUpTo } from '../lib/levels.js';
import { abandonPool, countAvailable, createPool, getActivePool, getPoolState, submitAnswer, takeHint } from '../services/practice.js';

const poolBody = z.object({
  mode: z.enum(PRACTICE_MODES as [string, ...string[]]).default('classic'),
  size: z.number().int().min(5).max(50).default(20),
  levels: z.array(z.enum(CEFR_LEVELS)).optional(),
  topics: z.array(z.string().min(1).max(80)).max(20).optional(),
  partsOfSpeech: z.array(z.string().min(1).max(30)).max(10).optional(),
});

const answerBody = z.object({
  wordId: z.number().int().positive(),
  answer: z.string().max(200),
  responseMs: z.number().int().min(0).max(600_000).default(0),
  hintsUsed: z.number().int().min(0).max(4).default(0),
});

const hintBody = z.object({
  wordId: z.number().int().positive(),
  kind: z.enum(['letter', 'gloss', 'length', 'choices']),
});

const practiceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** Экран выбора режима: что доступно и сколько слов готово к работе. */
  app.get('/overview', async (request) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: { cefrLevel: true, level: true },
    });

    const levels = levelsUpTo(user.cefrLevel);
    const availability = await countAvailable(request.userId, levels);

    const topics = await prisma.word.groupBy({
      by: ['topic'],
      where: { ownerId: null, isFunctionWord: false, topic: { not: null } },
      _count: true,
      orderBy: { _count: { topic: 'desc' } },
    });

    return {
      levels,
      availability,
      activePool: await getActivePool(request.userId),
      modes: PRACTICE_MODES.map((mode) => ({
        mode,
        label: MODE_LABELS[mode],
        unlockLevel: MODE_UNLOCK_LEVEL[mode],
        unlocked: user.level >= MODE_UNLOCK_LEVEL[mode],
      })),
      topics: topics.map((t) => ({ topic: t.topic as string, count: t._count })),
      hints: HINT_KINDS.map((kind) => ({
        kind,
        label: HINT_LABELS[kind],
        penalty: 1 - HINT_REWARD_FACTOR,
      })),
    };
  });

  app.post('/pools', async (request, reply) => {
    const parsed = poolBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Некорректные параметры пулла' });
    }

    const { mode, size, ...filters } = parsed.data;

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: { level: true },
    });
    const required = MODE_UNLOCK_LEVEL[mode as keyof typeof MODE_UNLOCK_LEVEL];
    if (user.level < required) {
      return reply.code(403).send({ error: `Режим откроется на ${required} уровне` });
    }

    const state = await createPool({
      userId: request.userId,
      mode: mode as never,
      size,
      filters: {
        levels: filters.levels,
        topics: filters.topics,
        partsOfSpeech: filters.partsOfSpeech,
      },
    });
    return reply.code(201).send(state);
  });

  app.get('/pools/active', async (request) => {
    return { state: await getActivePool(request.userId) };
  });

  app.get('/pools/:id', async (request) => {
    const { id } = request.params as { id: string };
    return getPoolState(request.userId, id);
  });

  app.post('/pools/:id/answer', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = answerBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Некорректный ответ' });
    }

    const result = await submitAnswer({ userId: request.userId, poolId: id, ...parsed.data });
    const state = await getPoolState(request.userId, id);
    return { result, state };
  });

  app.post('/pools/:id/hint', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = hintBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Некорректная подсказка' });
    }
    return takeHint(request.userId, id, parsed.data.wordId, parsed.data.kind);
  });

  app.post('/pools/:id/abandon', async (request) => {
    const { id } = request.params as { id: string };
    await abandonPool(request.userId, id);
    return { ok: true };
  });
};

export default practiceRoutes;
