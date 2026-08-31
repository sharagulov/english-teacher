import type { FastifyPluginAsync } from 'fastify';
import { FREEZE_GRANT_EVERY, MAX_STREAK_FREEZES, levelProgress, levelRewards } from '../lib/economy.js';
import { prisma } from '../db.js';
const rewardRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', app.authenticate);
    app.get('/', async (request) => {
        const user = await prisma.user.findUniqueOrThrow({
            where: { id: request.userId },
            select: { points: true, level: true, streakFreezes: true },
        });
        const items = levelRewards().map((item) => ({
            ...item,
            unlocked: user.level >= item.level,
            quantity: item.kind === 'freeze' ? user.streakFreezes : user.level >= item.level ? 1 : 0,
        }));
        return {
            points: user.points,
            progress: levelProgress(user.points),
            streakFreezes: user.streakFreezes,
            maxStreakFreezes: MAX_STREAK_FREEZES,
            freezeGrantEvery: FREEZE_GRANT_EVERY,
            items,
        };
    });
};
export default rewardRoutes;
