/**
 * Начисления, дневная активность и достижения.
 * Всё, что меняет баланс пользователя, проходит через этот модуль — так
 * история операций всегда сходится с текущим балансом.
 */
import { prisma } from '../db.js';
import { ACHIEVEMENTS_BY_CODE, evaluateAchievements, type AchievementMetrics } from '../lib/achievements.js';
import { DAILY_GOAL_REWARD, dailyStreakReward, levelProgress } from '../lib/economy.js';
import { daysBetween, todayKey } from '../lib/day.js';

export interface BalanceChange {
  coins: number;
  xp: number;
  balance: number;
  level: number;
  leveledUp: boolean;
}

/** Изменяет баланс и опыт, записывая операцию в историю. */
export async function applyBalance(
  userId: string,
  input: { coins?: number; xp?: number; reason: string; meta?: unknown },
): Promise<BalanceChange> {
  const coins = input.coins ?? 0;
  const xp = input.xp ?? 0;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { coins: true, xp: true, level: true, totalDelta: true },
  });

  const nextCoins = Math.max(0, user.coins + coins);
  const nextXp = Math.max(0, user.xp + xp);
  const nextLevel = levelProgress(nextXp).level;

  await prisma.user.update({
    where: { id: userId },
    data: {
      coins: nextCoins,
      xp: nextXp,
      level: nextLevel,
      totalDelta: coins > 0 ? { increment: coins } : undefined,
    },
  });

  if (coins !== 0) {
    await prisma.transaction.create({
      data: {
        userId,
        amount: coins,
        reason: input.reason,
        meta: input.meta === undefined ? null : JSON.stringify(input.meta),
        balanceAfter: nextCoins,
      },
    });
  }

  return {
    coins,
    xp,
    balance: nextCoins,
    level: nextLevel,
    leveledUp: nextLevel > user.level,
  };
}

/** Инкрементально обновляет агрегат за день (для графиков и статистики). */
export async function bumpDailyStat(
  userId: string,
  day: string,
  patch: Partial<Record<'attempts' | 'correct' | 'wrong' | 'newWords' | 'learned' | 'mastered' | 'coins' | 'xp' | 'timeMs' | 'aiTasks' | 'poolsDone', number>>,
): Promise<void> {
  const increments = Object.fromEntries(
    Object.entries(patch)
      .filter(([, value]) => typeof value === 'number' && value !== 0)
      .map(([key, value]) => [key, { increment: value }]),
  );

  await prisma.dailyStat.upsert({
    where: { userId_day: { userId, day } },
    update: increments,
    create: {
      userId,
      day,
      attempts: patch.attempts ?? 0,
      correct: patch.correct ?? 0,
      wrong: patch.wrong ?? 0,
      newWords: patch.newWords ?? 0,
      learned: patch.learned ?? 0,
      mastered: patch.mastered ?? 0,
      coins: patch.coins ?? 0,
      xp: patch.xp ?? 0,
      timeMs: patch.timeMs ?? 0,
      aiTasks: patch.aiTasks ?? 0,
      poolsDone: patch.poolsDone ?? 0,
    },
  });
}

export interface DailyActivityResult {
  streak: number;
  streakChanged: boolean;
  freezeUsed: boolean;
  rewards: { reason: string; coins: number; xp: number }[];
}

/**
 * Отмечает активность за сегодня: продлевает или обнуляет дневную серию,
 * при необходимости тратит заморозку и выдаёт бонус за серию.
 */
export async function registerDailyActivity(userId: string): Promise<DailyActivityResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      timezoneOffset: true,
      lastActiveDay: true,
      dailyStreak: true,
      longestStreak: true,
      streakFreezes: true,
      lastRewardedDay: true,
    },
  });

  const today = todayKey(user.timezoneOffset);
  const rewards: DailyActivityResult['rewards'] = [];

  if (user.lastActiveDay === today) {
    return { streak: user.dailyStreak, streakChanged: false, freezeUsed: false, rewards };
  }

  const gap = user.lastActiveDay ? daysBetween(user.lastActiveDay, today) : null;
  let streak = user.dailyStreak;
  let freezeUsed = false;

  if (gap === null) {
    streak = 1;
  } else if (gap === 1) {
    streak = user.dailyStreak + 1;
  } else if (gap > 1 && user.streakFreezes > 0 && gap - 1 <= user.streakFreezes) {
    // Заморозки закрывают пропущенные дни и сохраняют серию.
    freezeUsed = true;
    streak = user.dailyStreak + 1;
  } else {
    streak = 1;
  }

  const spentFreezes = freezeUsed ? gap! - 1 : 0;

  await prisma.user.update({
    where: { id: userId },
    data: {
      lastActiveDay: today,
      dailyStreak: streak,
      longestStreak: Math.max(user.longestStreak, streak),
      streakFreezes: { decrement: spentFreezes },
    },
  });

  if (user.lastRewardedDay !== today) {
    const coins = dailyStreakReward(streak);
    await prisma.user.update({ where: { id: userId }, data: { lastRewardedDay: today } });
    await applyBalance(userId, { coins, reason: 'daily_streak', meta: { streak } });
    await bumpDailyStat(userId, today, { coins });
    rewards.push({ reason: 'daily_streak', coins, xp: 0 });
  }

  return { streak, streakChanged: true, freezeUsed, rewards };
}

/**
 * Проверяет выполнение дневной цели по числу верных ответов
 * и выдаёт бонус один раз в день.
 */
export async function checkDailyGoal(userId: string): Promise<{ reached: boolean; justCompleted: boolean; correct: number; goal: number }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezoneOffset: true, dailyGoalWords: true },
  });
  const today = todayKey(user.timezoneOffset);

  const stat = await prisma.dailyStat.findUnique({ where: { userId_day: { userId, day: today } } });
  const correct = stat?.correct ?? 0;
  const reached = correct >= user.dailyGoalWords;

  if (!reached) return { reached, justCompleted: false, correct, goal: user.dailyGoalWords };

  const alreadyRewarded = await prisma.transaction.findFirst({
    where: { userId, reason: 'daily_goal', createdAt: { gte: new Date(`${today}T00:00:00.000Z`) } },
  });
  if (alreadyRewarded) return { reached, justCompleted: false, correct, goal: user.dailyGoalWords };

  await applyBalance(userId, { ...DAILY_GOAL_REWARD, reason: 'daily_goal', meta: { correct } });
  await bumpDailyStat(userId, today, DAILY_GOAL_REWARD);

  return { reached, justCompleted: true, correct, goal: user.dailyGoalWords };
}

/** Собирает показатели пользователя для сверки с порогами достижений. */
async function collectMetrics(userId: string): Promise<AchievementMetrics> {
  const [user, words, attempts, pools, perfectPools, aiTasks, bestStreak] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dailyStreak: true, totalDelta: true } }),
    prisma.userWord.groupBy({ by: ['status'], where: { userId }, _count: true }),
    prisma.attempt.count({ where: { userId, isCorrect: true } }),
    prisma.pool.count({ where: { userId, status: 'completed' } }),
    prisma.pool.count({ where: { userId, status: 'completed', wrongCount: 0 } }),
    prisma.aiSubmission.count({ where: { userId } }),
    prisma.userWord.aggregate({ where: { userId }, _max: { bestStreak: true } }),
  ]);

  const countByStatus = (status: string) => words.find((w) => w.status === status)?._count ?? 0;
  const learned = countByStatus('review') + countByStatus('mastered');

  return {
    wordsLearned: learned,
    wordsMastered: countByStatus('mastered'),
    totalCorrect: attempts,
    dailyStreak: user.dailyStreak,
    poolsCompleted: pools,
    perfectPools,
    bestSessionStreak: bestStreak._max.bestStreak ?? 0,
    aiTasksDone: aiTasks,
    coinsEarned: user.totalDelta,
  };
}

export interface UnlockedAchievement {
  code: string;
  title: string;
  description: string;
  coins: number;
  xp: number;
}

/** Выдаёт все достижения, порог которых пройден. Безопасно вызывать часто. */
export async function grantAchievements(userId: string): Promise<UnlockedAchievement[]> {
  const [metrics, existing] = await Promise.all([
    collectMetrics(userId),
    prisma.userAchievement.findMany({ where: { userId }, select: { code: true } }),
  ]);

  const pending = evaluateAchievements(metrics, new Set(existing.map((a) => a.code)));
  if (pending.length === 0) return [];

  const unlocked: UnlockedAchievement[] = [];

  for (const achievement of pending) {
    try {
      await prisma.userAchievement.create({
        data: { userId, code: achievement.code, progress: achievement.threshold },
      });
    } catch {
      // Уже выдано в параллельном запросе — пропускаем.
      continue;
    }
    await applyBalance(userId, {
      coins: achievement.coins,
      xp: achievement.xp,
      reason: `achievement:${achievement.code}`,
    });
    unlocked.push({
      code: achievement.code,
      title: achievement.title,
      description: achievement.description,
      coins: achievement.coins,
      xp: achievement.xp,
    });
  }

  return unlocked;
}

/** Полное описание достижений с отметкой о полученных. */
export async function listAchievements(userId: string) {
  const unlocked = await prisma.userAchievement.findMany({ where: { userId } });
  const unlockedMap = new Map(unlocked.map((u) => [u.code, u.unlockedAt]));

  return [...ACHIEVEMENTS_BY_CODE.values()].map((a) => ({
    ...a,
    unlockedAt: unlockedMap.get(a.code) ?? null,
  }));
}
