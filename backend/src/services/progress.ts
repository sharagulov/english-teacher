import { prisma } from '../db.js';
import { ACHIEVEMENTS_BY_CODE, evaluateAchievements, type AchievementMetrics } from '../lib/achievements.js';
import { DAILY_GOAL_REWARD, FREEZE_GRANT_EVERY, MAX_STREAK_FREEZES, dailyStreakReward, levelFromPoints, levelProgress, type LevelProgress, } from '../lib/economy.js';
import { daysBetween, todayKey } from '../lib/day.js';
export interface PointsAward {
    points: number;
    total: number;
    level: number;
    previousLevel: number;
    leveledUp: boolean;
    freezesGranted: number;
    transactionId?: number;
}
function freezesForLevelUp(previousLevel: number, nextLevel: number, held: number): number {
    const earned = Math.floor(nextLevel / FREEZE_GRANT_EVERY) - Math.floor(previousLevel / FREEZE_GRANT_EVERY);
    return Math.max(0, Math.min(earned, MAX_STREAK_FREEZES - held));
}
export async function awardPoints(userId: string, input: {
    points: number;
    reason: string;
    meta?: unknown;
}): Promise<PointsAward> {
    const points = Math.max(0, Math.round(input.points));
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { points: true, level: true, streakFreezes: true },
    });
    const total = user.points + points;
    const level = levelFromPoints(total);
    const freezesGranted = level > user.level ? freezesForLevelUp(user.level, level, user.streakFreezes) : 0;
    await prisma.user.update({
        where: { id: userId },
        data: {
            points: total,
            level,
            ...(freezesGranted > 0 ? { streakFreezes: { increment: freezesGranted } } : {}),
        },
    });
    let transactionId: number | undefined;
    if (points !== 0) {
        const row = await prisma.transaction.create({
            data: {
                userId,
                amount: points,
                reason: input.reason,
                meta: input.meta === undefined ? null : JSON.stringify(input.meta),
                balanceAfter: total,
            },
        });
        transactionId = row.id;
    }
    return {
        points,
        total,
        level,
        previousLevel: user.level,
        leveledUp: level > user.level,
        freezesGranted,
        transactionId,
    };
}
export async function subtractPoints(userId: string, points: number, transactionId?: number | null) {
    const amount = Math.max(0, Math.round(points));
    if (amount === 0) {
        const user = await prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { points: true, level: true },
        });
        return { total: user.points, level: user.level, progress: levelProgress(user.points) };
    }
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { points: true },
    });
    const total = Math.max(0, user.points - amount);
    const level = levelFromPoints(total);
    await prisma.user.update({
        where: { id: userId },
        data: { points: total, level },
    });
    if (transactionId) {
        await prisma.transaction.deleteMany({ where: { id: transactionId, userId } });
    }
    return { total, level, progress: levelProgress(total) };
}
export interface PointsSpend {
    points: number;
    total: number;
    level: number;
    previousLevel: number;
    leveledDown: boolean;
    progress: LevelProgress;
}
export async function spendPoints(userId: string, input: {
    points: number;
    reason: string;
    meta?: unknown;
}): Promise<PointsSpend> {
    const amount = Math.max(0, Math.round(input.points));
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { points: true, level: true },
    });
    if (amount === 0) {
        return {
            points: 0,
            total: user.points,
            level: user.level,
            previousLevel: user.level,
            leveledDown: false,
            progress: levelProgress(user.points),
        };
    }
    if (user.points < amount) {
        throw Object.assign(new Error('Не хватает рейтинга на подсказку'), { statusCode: 400 });
    }
    const total = user.points - amount;
    const level = levelFromPoints(total);
    await prisma.user.update({
        where: { id: userId },
        data: { points: total, level },
    });
    await prisma.transaction.create({
        data: {
            userId,
            amount: -amount,
            reason: input.reason,
            meta: input.meta === undefined ? null : JSON.stringify(input.meta),
            balanceAfter: total,
        },
    });
    return {
        points: amount,
        total,
        level,
        previousLevel: user.level,
        leveledDown: level < user.level,
        progress: levelProgress(total),
    };
}
export async function bumpDailyStat(userId: string, day: string, patch: Partial<Record<'attempts' | 'correct' | 'wrong' | 'newWords' | 'learned' | 'mastered' | 'points' | 'timeMs' | 'aiTasks' | 'poolsDone', number>>): Promise<void> {
    const increments = Object.fromEntries(Object.entries(patch)
        .filter(([, value]) => typeof value === 'number' && value !== 0)
        .map(([key, value]) => [key, { increment: value }]));
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
            points: patch.points ?? 0,
            timeMs: patch.timeMs ?? 0,
            aiTasks: patch.aiTasks ?? 0,
            poolsDone: patch.poolsDone ?? 0,
        },
    });
}
export async function decrementDailyStat(userId: string, day: string, patch: Partial<Record<'attempts' | 'correct' | 'wrong' | 'newWords' | 'learned' | 'mastered' | 'points' | 'timeMs' | 'poolsDone', number>>): Promise<void> {
    const stat = await prisma.dailyStat.findUnique({ where: { userId_day: { userId, day } } });
    if (!stat)
        return;
    const clamp = (current: number, delta: number | undefined) => delta ? Math.max(0, current - delta) : current;
    await prisma.dailyStat.update({
        where: { userId_day: { userId, day } },
        data: {
            attempts: clamp(stat.attempts, patch.attempts),
            correct: clamp(stat.correct, patch.correct),
            wrong: clamp(stat.wrong, patch.wrong),
            newWords: clamp(stat.newWords, patch.newWords),
            learned: clamp(stat.learned, patch.learned),
            mastered: clamp(stat.mastered, patch.mastered),
            points: clamp(stat.points, patch.points),
            timeMs: clamp(stat.timeMs, patch.timeMs),
            poolsDone: clamp(stat.poolsDone, patch.poolsDone),
        },
    });
}
export interface DailyActivityResult {
    streak: number;
    streakChanged: boolean;
    freezeUsed: boolean;
    rewards: {
        reason: string;
        points: number;
    }[];
}
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
    }
    else if (gap === 1) {
        streak = user.dailyStreak + 1;
    }
    else if (gap > 1 && user.streakFreezes > 0 && gap - 1 <= user.streakFreezes) {
        freezeUsed = true;
        streak = user.dailyStreak + 1;
    }
    else {
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
        const points = dailyStreakReward(streak);
        await prisma.user.update({ where: { id: userId }, data: { lastRewardedDay: today } });
        await awardPoints(userId, { points, reason: 'daily_streak', meta: { streak } });
        await bumpDailyStat(userId, today, { points });
        rewards.push({ reason: 'daily_streak', points });
    }
    return { streak, streakChanged: true, freezeUsed, rewards };
}
export async function checkDailyGoal(userId: string): Promise<{
    reached: boolean;
    justCompleted: boolean;
    correct: number;
    goal: number;
}> {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezoneOffset: true, dailyGoalWords: true },
    });
    const today = todayKey(user.timezoneOffset);
    const stat = await prisma.dailyStat.findUnique({ where: { userId_day: { userId, day: today } } });
    const correct = stat?.correct ?? 0;
    const reached = correct >= user.dailyGoalWords;
    if (!reached)
        return { reached, justCompleted: false, correct, goal: user.dailyGoalWords };
    const alreadyRewarded = await prisma.transaction.findFirst({
        where: { userId, reason: 'daily_goal', createdAt: { gte: new Date(`${today}T00:00:00.000Z`) } },
    });
    if (alreadyRewarded)
        return { reached, justCompleted: false, correct, goal: user.dailyGoalWords };
    await awardPoints(userId, { points: DAILY_GOAL_REWARD, reason: 'daily_goal', meta: { correct } });
    await bumpDailyStat(userId, today, { points: DAILY_GOAL_REWARD });
    return { reached, justCompleted: true, correct, goal: user.dailyGoalWords };
}
async function collectMetrics(userId: string): Promise<AchievementMetrics> {
    const [user, words, attempts, pools, perfectPools, aiTasks, bestStreak] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dailyStreak: true, level: true } }),
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
        ratingLevel: user.level,
    };
}
export interface UnlockedAchievement {
    code: string;
    title: string;
    description: string;
    points: number;
}
export async function grantAchievements(userId: string): Promise<UnlockedAchievement[]> {
    const [metrics, existing] = await Promise.all([
        collectMetrics(userId),
        prisma.userAchievement.findMany({ where: { userId }, select: { code: true } }),
    ]);
    const pending = evaluateAchievements(metrics, new Set(existing.map((a) => a.code)));
    if (pending.length === 0)
        return [];
    const unlocked: UnlockedAchievement[] = [];
    for (const achievement of pending) {
        try {
            await prisma.userAchievement.create({
                data: { userId, code: achievement.code, progress: achievement.threshold },
            });
        }
        catch {
            continue;
        }
        await awardPoints(userId, {
            points: achievement.points,
            reason: `achievement:${achievement.code}`,
        });
        unlocked.push({
            code: achievement.code,
            title: achievement.title,
            description: achievement.description,
            points: achievement.points,
        });
    }
    return unlocked;
}
export async function listAchievements(userId: string) {
    const unlocked = await prisma.userAchievement.findMany({ where: { userId } });
    const unlockedMap = new Map(unlocked.map((u) => [u.code, u.unlockedAt]));
    return [...ACHIEVEMENTS_BY_CODE.values()].map((a) => ({
        ...a,
        unlockedAt: unlockedMap.get(a.code) ?? null,
    }));
}
