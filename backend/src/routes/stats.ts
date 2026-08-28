import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { lastDays, todayKey } from '../lib/day.js';
import { levelProgress } from '../lib/economy.js';
import { CEFR_LEVELS } from '../lib/levels.js';
import { parseStringArray } from '../lib/text.js';
import { listAchievements } from '../services/progress.js';
import { getAiUsageOverview } from '../services/ai-usage.js';

const WORD_STATUSES = ['new', 'learning', 'review', 'mastered', 'leech'] as const;

const statsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** Сводка: всё главное одним запросом для дашборда. */
  app.get('/overview', async (request) => {
    const userId = request.userId;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        points: true,
        level: true,
        dailyStreak: true,
        longestStreak: true,
        dailyGoalWords: true,
        timezoneOffset: true,
        cefrLevel: true,
        createdAt: true,
      },
    });

    const today = todayKey(user.timezoneOffset);
    const now = new Date();

    const [byStatus, attemptsAgg, correctCount, pools, perfectPools, todayStat, dueNow, dueTomorrow, dueWeek, aiCount, bestStreak, totalWords] =
      await Promise.all([
        prisma.userWord.groupBy({ by: ['status'], where: { userId }, _count: true }),
        prisma.attempt.aggregate({ where: { userId }, _count: true, _avg: { responseMs: true }, _sum: { responseMs: true } }),
        prisma.attempt.count({ where: { userId, isCorrect: true } }),
        prisma.pool.count({ where: { userId, status: 'completed' } }),
        prisma.pool.count({ where: { userId, status: 'completed', wrongCount: 0 } }),
        prisma.dailyStat.findUnique({ where: { userId_day: { userId, day: today } } }),
        prisma.userWord.count({ where: { userId, isIgnored: false, dueAt: { lte: now } } }),
        prisma.userWord.count({
          where: { userId, isIgnored: false, dueAt: { gt: now, lte: new Date(now.getTime() + 86_400_000) } },
        }),
        prisma.userWord.count({
          where: { userId, isIgnored: false, dueAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) } },
        }),
        prisma.aiSubmission.count({ where: { userId } }),
        prisma.userWord.aggregate({ where: { userId }, _max: { bestStreak: true } }),
        prisma.word.count({ where: { ownerId: null, isFunctionWord: false } }),
      ]);

    const statusCount = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;
    const encountered = byStatus.reduce((sum, s) => sum + s._count, 0);
    const attempts = attemptsAgg._count;

    return {
      user: { ...user, progress: levelProgress(user.points) },
      words: {
        encountered,
        learning: statusCount('learning'),
        review: statusCount('review'),
        mastered: statusCount('mastered'),
        leech: statusCount('leech'),
        learned: statusCount('review') + statusCount('mastered'),
        dictionaryTotal: totalWords,
        coverage: totalWords > 0 ? encountered / totalWords : 0,
      },
      answers: {
        attempts,
        correct: correctCount,
        wrong: attempts - correctCount,
        accuracy: attempts > 0 ? correctCount / attempts : 0,
        avgResponseMs: Math.round(attemptsAgg._avg.responseMs ?? 0),
        totalTimeMs: attemptsAgg._sum.responseMs ?? 0,
        bestWordStreak: bestStreak._max.bestStreak ?? 0,
      },
      pools: { completed: pools, perfect: perfectPools },
      today: {
        day: today,
        correct: todayStat?.correct ?? 0,
        attempts: todayStat?.attempts ?? 0,
        newWords: todayStat?.newWords ?? 0,
        points: todayStat?.points ?? 0,
        timeMs: todayStat?.timeMs ?? 0,
        goal: user.dailyGoalWords,
        goalProgress: Math.min((todayStat?.correct ?? 0) / user.dailyGoalWords, 1),
      },
      review: { dueNow, dueTomorrow, dueWeek },
      ai: { submissions: aiCount },
      rating: { points: user.points, level: user.level, progress: levelProgress(user.points) },
    };
  });

  /** Ряды по дням — для графиков активности и точности. */
  app.get('/daily', async (request) => {
    const query = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(request.query);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: { timezoneOffset: true },
    });

    const days = lastDays(query.days, user.timezoneOffset);
    const rows = await prisma.dailyStat.findMany({
      where: { userId: request.userId, day: { in: days } },
    });
    const byDay = new Map(rows.map((r) => [r.day, r]));

    return {
      series: days.map((day) => {
        const row = byDay.get(day);
        const attempts = row?.attempts ?? 0;
        return {
          day,
          attempts,
          correct: row?.correct ?? 0,
          wrong: row?.wrong ?? 0,
          accuracy: attempts > 0 ? (row?.correct ?? 0) / attempts : null,
          newWords: row?.newWords ?? 0,
          learned: row?.learned ?? 0,
          mastered: row?.mastered ?? 0,
          points: row?.points ?? 0,
          timeMs: row?.timeMs ?? 0,
          aiTasks: row?.aiTasks ?? 0,
          poolsDone: row?.poolsDone ?? 0,
        };
      }),
    };
  });

  /**
   * Таблица слов пользователя со всеми показателями.
   * Именно она отвечает на вопрос «где я ошибаюсь чаще всего».
   */
  app.get('/words', async (request) => {
    const query = z
      .object({
        status: z.enum(WORD_STATUSES).optional(),
        level: z.enum(CEFR_LEVELS).optional(),
        search: z.string().trim().max(60).optional(),
        sort: z
          .enum(['errors', 'accuracy', 'strength', 'recent', 'due', 'alphabet', 'seen', 'slowest'])
          .default('errors'),
        order: z.enum(['asc', 'desc']).default('desc'),
        favorite: z.coerce.boolean().optional(),
        page: z.coerce.number().int().min(1).default(1),
        perPage: z.coerce.number().int().min(5).max(200).default(50),
      })
      .parse(request.query);

    const where = {
      userId: request.userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.favorite ? { isFavorite: true } : {}),
      word: {
        ...(query.level ? { level: query.level } : {}),
        ...(query.search ? { text: { contains: query.search } } : {}),
      },
    };

    const orderBy = (() => {
      switch (query.sort) {
        case 'errors':
          return [{ timesWrong: query.order }, { timesSeen: 'desc' as const }];
        case 'strength':
          return [{ strength: query.order }];
        case 'recent':
          return [{ lastSeenAt: query.order }];
        case 'due':
          return [{ dueAt: query.order }];
        case 'seen':
          return [{ timesSeen: query.order }];
        case 'slowest':
          return [{ avgResponseMs: query.order }];
        case 'alphabet':
          return [{ word: { text: query.order } }];
        case 'accuracy':
        default:
          return [{ timesCorrect: query.order }, { timesWrong: 'desc' as const }];
      }
    })();

    const [total, rows] = await Promise.all([
      prisma.userWord.count({ where }),
      prisma.userWord.findMany({
        where,
        include: { word: true },
        orderBy,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);

    return {
      total,
      page: query.page,
      perPage: query.perPage,
      items: rows.map((row) => ({
        wordId: row.wordId,
        text: row.word.text,
        translations: parseStringArray(row.word.translations),
        level: row.word.level,
        partOfSpeech: row.word.partOfSpeech,
        topic: row.word.topic,
        gloss: row.word.gloss,
        timesSeen: row.timesSeen,
        timesCorrect: row.timesCorrect,
        timesWrong: row.timesWrong,
        accuracy: row.timesSeen > 0 ? row.timesCorrect / row.timesSeen : null,
        currentStreak: row.currentStreak,
        bestStreak: row.bestStreak,
        strength: row.strength,
        ease: row.ease,
        intervalDays: row.intervalDays,
        repetitions: row.repetitions,
        lapses: row.lapses,
        status: row.status,
        avgResponseMs: row.avgResponseMs,
        hintsUsed: row.hintsUsed,
        lastSeenAt: row.lastSeenAt,
        dueAt: row.dueAt,
        isFavorite: row.isFavorite,
        isIgnored: row.isIgnored,
        dislikeLevel: row.dislikeLevel,
      })),
    };
  });

  /** Разрезы: по уровням, режимам, темам, времени суток. */
  app.get('/breakdown', async (request) => {
    const userId = request.userId;

    const [byLevel, byMode, byMatchType, byTopic, hourly] = await Promise.all([
      prisma.$queryRawUnsafe<{ level: string; status: string; count: bigint }[]>(
        `SELECT w.level AS level, uw.status AS status, COUNT(*) AS count
           FROM UserWord uw JOIN Word w ON w.id = uw.wordId
          WHERE uw.userId = ?
          GROUP BY w.level, uw.status`,
        userId,
      ),
      prisma.$queryRawUnsafe<{ mode: string; attempts: bigint; correct: bigint; avgMs: number }[]>(
        `SELECT mode,
                COUNT(*) AS attempts,
                SUM(CASE WHEN isCorrect THEN 1 ELSE 0 END) AS correct,
                AVG(responseMs) AS avgMs
           FROM Attempt WHERE userId = ? GROUP BY mode`,
        userId,
      ),
      prisma.$queryRawUnsafe<{ matchType: string; count: bigint }[]>(
        `SELECT matchType, COUNT(*) AS count FROM Attempt WHERE userId = ? GROUP BY matchType`,
        userId,
      ),
      prisma.$queryRawUnsafe<{ topic: string; attempts: bigint; correct: bigint }[]>(
        `SELECT w.topic AS topic,
                COUNT(*) AS attempts,
                SUM(CASE WHEN a.isCorrect THEN 1 ELSE 0 END) AS correct
           FROM Attempt a JOIN Word w ON w.id = a.wordId
          WHERE a.userId = ? AND w.topic IS NOT NULL
          GROUP BY w.topic
          ORDER BY attempts DESC
          LIMIT 20`,
        userId,
      ),
      prisma.$queryRawUnsafe<{ hour: string; attempts: bigint; correct: bigint }[]>(
        `SELECT strftime('%H', createdAt / 1000, 'unixepoch') AS hour,
                COUNT(*) AS attempts,
                SUM(CASE WHEN isCorrect THEN 1 ELSE 0 END) AS correct
           FROM Attempt WHERE userId = ? GROUP BY hour ORDER BY hour`,
        userId,
      ),
    ]);

    const num = (value: bigint | number | null) => Number(value ?? 0);

    return {
      byLevel: CEFR_LEVELS.map((level) => {
        const rows = byLevel.filter((r) => r.level === level);
        const counts = Object.fromEntries(WORD_STATUSES.map((s) => [s, num(rows.find((r) => r.status === s)?.count ?? 0)]));
        return { level, ...counts, total: rows.reduce((sum, r) => sum + num(r.count), 0) };
      }),
      byMode: byMode.map((r) => ({
        mode: r.mode,
        attempts: num(r.attempts),
        correct: num(r.correct),
        accuracy: num(r.attempts) > 0 ? num(r.correct) / num(r.attempts) : null,
        avgResponseMs: Math.round(r.avgMs ?? 0),
      })),
      byMatchType: byMatchType.map((r) => ({ matchType: r.matchType, count: num(r.count) })),
      byTopic: byTopic.map((r) => ({
        topic: r.topic,
        attempts: num(r.attempts),
        correct: num(r.correct),
        accuracy: num(r.attempts) > 0 ? num(r.correct) / num(r.attempts) : null,
      })),
      byHour: Array.from({ length: 24 }, (_, hour) => {
        const row = hourly.find((r) => Number(r.hour) === hour);
        return {
          hour,
          attempts: num(row?.attempts ?? 0),
          correct: num(row?.correct ?? 0),
        };
      }),
    };
  });

  /** Последние попытки — журнал для разбора ошибок. */
  app.get('/attempts', async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(10).max(200).default(50),
        onlyWrong: z.coerce.boolean().default(false),
      })
      .parse(request.query);

    const attempts = await prisma.attempt.findMany({
      where: { userId: request.userId, ...(query.onlyWrong ? { isCorrect: false } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit,
      include: { word: { select: { text: true, level: true, translations: true } } },
    });

    return {
      items: attempts.map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        mode: a.mode,
        direction: a.direction,
        question: a.question,
        expected: a.expected,
        given: a.given,
        isCorrect: a.isCorrect,
        matchType: a.matchType,
        responseMs: a.responseMs,
        hintsUsed: a.hintsUsed,
        points: a.points,
        word: { text: a.word.text, level: a.word.level, translations: parseStringArray(a.word.translations) },
      })),
    };
  });

  /** История начислений очков рейтинга. */
  app.get('/transactions', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(10).max(200).default(50) }).parse(request.query);
    const items = await prisma.transaction.findMany({
      where: { userId: request.userId },
      orderBy: { id: 'desc' },
      take: query.limit,
    });
    return { items };
  });

  app.get('/achievements', async (request) => {
    return { items: await listAchievements(request.userId) };
  });

  /** История пуллов. */
  app.get('/pools', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(5).max(100).default(30) }).parse(request.query);
    const items = await prisma.pool.findMany({
      where: { userId: request.userId, status: { not: 'active' } },
      orderBy: { id: 'desc' },
      take: query.limit,
      select: {
        id: true,
        mode: true,
        size: true,
        ordinal: true,
        status: true,
        correctCount: true,
        wrongCount: true,
        pointsEarned: true,
        durationMs: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return { items };
  });

  /** Расход токенов и оценка стоимости вызовов OpenAI. */
  app.get('/ai-usage', async (request) => getAiUsageOverview(request.userId));
};

export default statsRoutes;
