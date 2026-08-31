import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { levelProgress } from '../lib/economy.js';
import { CEFR_LEVELS } from '../lib/levels.js';
const credentials = z.object({
    email: z.string().trim().toLowerCase().email('Некорректный адрес почты'),
    password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(200),
});
const registerBody = credentials.extend({
    name: z.string().trim().min(1, 'Укажите имя').max(60),
    cefrLevel: z.enum(CEFR_LEVELS).default('A2'),
    timezoneOffset: z.number().int().min(-840).max(840).default(180),
});
export async function publicUser(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true,
            points: true,
            level: true,
            dailyStreak: true,
            longestStreak: true,
            streakFreezes: true,
            dailyGoalWords: true,
            cefrLevel: true,
            typoTolerance: true,
            soundEnabled: true,
            autoAdvance: true,
            showTranscript: true,
            timezoneOffset: true,
            createdAt: true,
        },
    });
    return { ...user, progress: levelProgress(user.points) };
}
const authRoutes: FastifyPluginAsync = async (app) => {
    app.post('/register', async (request, reply) => {
        const parsed = registerBody.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' });
        }
        const { email, password, name, cefrLevel, timezoneOffset } = parsed.data;
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return reply.code(409).send({ error: 'Пользователь с такой почтой уже есть' });
        }
        const user = await prisma.user.create({
            data: {
                email,
                name,
                cefrLevel,
                timezoneOffset,
                passwordHash: await bcrypt.hash(password, 10),
            },
        });
        const token = app.jwt.sign({ sub: user.id, email: user.email });
        return reply.code(201).send({ token, user: await publicUser(user.id) });
    });
    app.post('/login', async (request, reply) => {
        const parsed = credentials.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Укажите почту и пароль' });
        }
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
            return reply.code(401).send({ error: 'Неверная почта или пароль' });
        }
        const token = app.jwt.sign({ sub: user.id, email: user.email });
        return { token, user: await publicUser(user.id) };
    });
    app.get('/me', { preHandler: app.authenticate }, async (request) => {
        return { user: await publicUser(request.userId) };
    });
    const settingsBody = z.object({
        name: z.string().trim().min(1).max(60).optional(),
        cefrLevel: z.enum(CEFR_LEVELS).optional(),
        dailyGoalWords: z.number().int().min(5).max(500).optional(),
        typoTolerance: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
        autoAdvance: z.boolean().optional(),
        showTranscript: z.boolean().optional(),
        timezoneOffset: z.number().int().min(-840).max(840).optional(),
    });
    app.patch('/me', { preHandler: app.authenticate }, async (request, reply) => {
        const parsed = settingsBody.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Некорректные настройки' });
        }
        await prisma.user.update({ where: { id: request.userId }, data: parsed.data });
        return { user: await publicUser(request.userId) };
    });
};
export default authRoutes;
