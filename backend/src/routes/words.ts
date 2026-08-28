import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { CEFR_LEVELS } from '../lib/levels.js';
import { normalize, parseStringArray } from '../lib/text.js';
import { enrichWord } from '../services/enrich.js';
import { ensureExamplesForWord, examplesForWord } from '../services/examples.js';
import { parseSenses } from '../services/practice.js';

const wordRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** Просмотр всего словаря с фильтрами и отметкой личного прогресса. */
  app.get('/', async (request) => {
    const query = z
      .object({
        search: z.string().trim().max(60).optional(),
        level: z.enum(CEFR_LEVELS).optional(),
        topic: z.string().trim().max(80).optional(),
        partOfSpeech: z.string().trim().max(30).optional(),
        onlyUnseen: z.coerce.boolean().optional(),
        page: z.coerce.number().int().min(1).default(1),
        perPage: z.coerce.number().int().min(5).max(200).default(50),
      })
      .parse(request.query);

    const where = {
      ownerId: null,
      isFunctionWord: false,
      ...(query.level ? { level: query.level } : {}),
      ...(query.topic ? { topic: query.topic } : {}),
      ...(query.partOfSpeech ? { partOfSpeech: query.partOfSpeech } : {}),
      ...(query.search ? { text: { startsWith: query.search.toLowerCase() } } : {}),
      ...(query.onlyUnseen ? { userWords: { none: { userId: request.userId } } } : {}),
    };

    const [total, words] = await Promise.all([
      prisma.word.count({ where }),
      prisma.word.findMany({
        where,
        orderBy: [{ frequencyRank: { sort: 'asc', nulls: 'last' } }, { text: 'asc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: {
          userWords: { where: { userId: request.userId }, take: 1 },
        },
      }),
    ]);

    return {
      total,
      page: query.page,
      perPage: query.perPage,
      items: words.map((word) => {
        const progress = word.userWords[0];
        return {
          id: word.id,
          text: word.text,
          translations: parseStringArray(word.translations),
          level: word.level,
          partOfSpeech: word.partOfSpeech,
          topic: word.topic,
          gloss: word.gloss,
          transcription: word.transcription,
          frequencyRank: word.frequencyRank,
          progress: progress
            ? {
                status: progress.status,
                strength: progress.strength,
                timesSeen: progress.timesSeen,
                timesWrong: progress.timesWrong,
                isFavorite: progress.isFavorite,
                isIgnored: progress.isIgnored,
              }
            : null,
        };
      }),
    };
  });

  /**
   * Карточка слова: подробности, значения и личная статистика.
   * Отвечает только из своей базы — внешние источники здесь не опрашиваются,
   * чтобы карточка открывалась мгновенно.
   */
  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    const word = await prisma.word.findUnique({ where: { id } });
    if (!word) return reply.code(404).send({ error: 'Слово не найдено' });

    const progress = await prisma.userWord.findUnique({
      where: { userId_wordId: { userId: request.userId, wordId: id } },
    });

    const recentAttempts = await prisma.attempt.findMany({
      where: { userId: request.userId, wordId: id },
      orderBy: { id: 'desc' },
      take: 12,
      select: { createdAt: true, given: true, isCorrect: true, matchType: true, responseMs: true, mode: true },
    });

    return {
      word: {
        id: word.id,
        text: word.text,
        translations: parseStringArray(word.translations),
        level: word.level,
        partOfSpeech: word.partOfSpeech,
        topic: word.topic,
        gloss: word.gloss,
        senses: parseSenses(word.senses),
        examples: await examplesForWord(id),
        transcription: word.transcription,
        audioUrl: word.audioUrl,
        example: word.example,
        frequencyRank: word.frequencyRank,
        license: word.license,
        enriched: word.enrichedAt != null,
      },
      progress,
      recentAttempts,
    };
  });

  /**
   * Догрузка транскрипции, озвучки и примера из открытого словаря.
   * Клиент вызывает это после отрисовки карточки, поэтому ожидание сети
   * не задерживает основной ответ.
   */
  app.post('/:id/enrich', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    const exists = await prisma.word.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: 'Слово не найдено' });

    const word = await enrichWord(id);
    return {
      transcription: word.transcription,
      audioUrl: word.audioUrl,
      example: word.example,
      gloss: word.gloss,
      enriched: word.enrichedAt != null,
    };
  });

  /**
   * Примеры употребления. Разбор ответа в тренажёре получает их сразу в своём
   * ответе; этот маршрут — запасной путь для слов, до которых фоновая
   * подготовка ещё не добралась.
   */
  app.get('/:id/examples', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    const exists = await prisma.word.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: 'Слово не найдено' });

    return { examples: await ensureExamplesForWord(id) };
  });

  const flagsBody = z.object({
    isFavorite: z.boolean().optional(),
    isIgnored: z.boolean().optional(),
  });

  /** Избранное и исключение слова из выдачи. */
  app.patch('/:id/flags', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const parsed = flagsBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Некорректные флаги' });

    const progress = await prisma.userWord.upsert({
      where: { userId_wordId: { userId: request.userId, wordId: id } },
      create: { userId: request.userId, wordId: id, ...parsed.data },
      update: parsed.data,
    });
    return { progress };
  });

  /** Сброс прогресса по слову — начать его изучение заново. */
  app.post('/:id/reset', async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    await prisma.userWord.deleteMany({ where: { userId: request.userId, wordId: id } });
    return { ok: true };
  });

  const customWordBody = z.object({
    text: z.string().trim().toLowerCase().min(1).max(60),
    translations: z.array(z.string().trim().min(1).max(60)).min(1).max(8),
    level: z.enum(CEFR_LEVELS).default('B1'),
    partOfSpeech: z.string().trim().max(30).optional(),
    topic: z.string().trim().max(80).optional(),
    gloss: z.string().trim().max(200).optional(),
  });

  /** Своё слово: добавляется в личный словарь и участвует в тренировках. */
  app.post('/custom', async (request, reply) => {
    const parsed = customWordBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Некорректное слово' });
    }
    const data = parsed.data;

    const duplicate = await prisma.word.findFirst({
      where: { text: data.text, OR: [{ ownerId: null }, { ownerId: request.userId }] },
    });
    if (duplicate) {
      return reply.code(409).send({ error: 'Такое слово уже есть в словаре', wordId: duplicate.id });
    }

    const word = await prisma.word.create({
      data: {
        text: data.text,
        translations: JSON.stringify([...new Set(data.translations.map((t) => t.trim()))]),
        level: data.level,
        partOfSpeech: data.partOfSpeech ?? null,
        topic: data.topic ?? null,
        gloss: data.gloss ?? null,
        source: 'user',
        ownerId: request.userId,
      },
    });

    return reply.code(201).send({ wordId: word.id });
  });

  /** Быстрая проверка перевода вне тренировки — «а как это по-русски?». */
  app.get('/lookup/:text', async (request, reply) => {
    const { text } = z.object({ text: z.string().trim().max(60) }).parse(request.params);
    const key = normalize(text);

    const word = await prisma.word.findFirst({
      where: { text: key, OR: [{ ownerId: null }, { ownerId: request.userId }] },
    });
    if (!word) return reply.code(404).send({ error: 'Слово не найдено в словаре' });

    return { wordId: word.id, translations: parseStringArray(word.translations), level: word.level };
  });

  /** Список тем словаря для фильтров. */
  app.get('/meta/topics', async () => {
    const topics = await prisma.word.groupBy({
      by: ['topic'],
      where: { ownerId: null, isFunctionWord: false, topic: { not: null } },
      _count: true,
      orderBy: { _count: { topic: 'desc' } },
    });
    const parts = await prisma.word.groupBy({
      by: ['partOfSpeech'],
      where: { ownerId: null, isFunctionWord: false, partOfSpeech: { not: null } },
      _count: true,
      orderBy: { _count: { partOfSpeech: 'desc' } },
    });

    return {
      topics: topics.map((t) => ({ topic: t.topic as string, count: t._count })),
      partsOfSpeech: parts.map((p) => ({ partOfSpeech: p.partOfSpeech as string, count: p._count })),
    };
  });
};

export default wordRoutes;
