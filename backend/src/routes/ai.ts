import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { AI_TASK_DESCRIPTIONS, AI_TASK_LABELS, AI_TASK_TYPES, GRAMMAR_TOPICS } from '../lib/ai.js';
import { CEFR_LEVELS } from '../lib/levels.js';
import { CHAT_SCENARIOS, chatTurn, createChatSession, generateTask, getListeningText, submitTask } from '../services/ai.js';
const aiRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', app.authenticate);
    app.get('/meta', async () => ({
        enabled: env.aiEnabled,
        model: env.aiEnabled ? env.OPENAI_MODEL : null,
        types: AI_TASK_TYPES.map((type) => ({
            type,
            label: AI_TASK_LABELS[type],
            description: AI_TASK_DESCRIPTIONS[type],
        })),
        grammarTopics: GRAMMAR_TOPICS,
        scenarios: CHAT_SCENARIOS,
    }));
    const generateBody = z.object({
        type: z.enum(AI_TASK_TYPES),
        topic: z.string().trim().max(80).optional(),
        level: z.enum(CEFR_LEVELS).optional(),
        wordId: z.number().int().positive().optional(),
    });
    app.post('/tasks', async (request, reply) => {
        const parsed = generateBody.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Некорректный запрос' });
        }
        const task = await generateTask({ userId: request.userId, ...parsed.data });
        return reply.code(201).send({ task });
    });
    app.post('/tasks/:id/submit', async (request, reply) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
        const parsed = z.object({ answer: z.string().max(4000) }).safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Некорректный ответ' });
        return { result: await submitTask(request.userId, id, parsed.data.answer) };
    });
    app.get('/tasks/:id/audio-text', async (request) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
        return { text: await getListeningText(request.userId, id) };
    });
    app.get('/history', async (request) => {
        const query = z.object({ limit: z.coerce.number().int().min(5).max(100).default(30) }).parse(request.query);
        const submissions = await prisma.aiSubmission.findMany({
            where: { userId: request.userId },
            orderBy: { id: 'desc' },
            take: query.limit,
            include: { task: { select: { type: true, level: true, topic: true, payload: true } } },
        });
        return {
            items: submissions.map((s) => ({
                id: s.id,
                createdAt: s.createdAt,
                score: s.score,
                isCorrect: s.isCorrect,
                answer: s.answer,
                feedback: JSON.parse(s.feedback),
                points: s.points,
                type: s.task.type,
                label: AI_TASK_LABELS[s.task.type as keyof typeof AI_TASK_LABELS] ?? s.task.type,
                level: s.task.level,
                topic: s.task.topic,
            })),
        };
    });
    app.get('/chats', async (request) => {
        const items = await prisma.chatSession.findMany({
            where: { userId: request.userId },
            orderBy: { updatedAt: 'desc' },
            take: 30,
            include: { _count: { select: { messages: true } } },
        });
        return {
            items: items.map((s) => ({
                id: s.id,
                title: s.title,
                scenario: s.scenario,
                level: s.level,
                messages: s._count.messages,
                updatedAt: s.updatedAt,
            })),
        };
    });
    app.post('/chats', async (request, reply) => {
        const parsed = z
            .object({ scenario: z.string().min(1).max(30).default('free'), title: z.string().trim().max(80).optional() })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Некорректный сценарий' });
        const session = await createChatSession(request.userId, parsed.data.scenario, parsed.data.title);
        return reply.code(201).send({ session });
    });
    app.get('/chats/:id', async (request) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
        const session = await prisma.chatSession.findFirstOrThrow({
            where: { id, userId: request.userId },
            include: { messages: { orderBy: { id: 'asc' } } },
        });
        return {
            session: { id: session.id, title: session.title, scenario: session.scenario, level: session.level },
            messages: session.messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                correction: m.correction ? JSON.parse(m.correction) : null,
                createdAt: m.createdAt,
            })),
        };
    });
    app.post('/chats/:id/messages', async (request, reply) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
        const parsed = z.object({ message: z.string().trim().min(1).max(2000) }).safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Пустое сообщение' });
        return { result: await chatTurn(request.userId, id, parsed.data.message) };
    });
    app.delete('/chats/:id', async (request) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
        await prisma.chatSession.deleteMany({ where: { id, userId: request.userId } });
        return { ok: true };
    });
};
export default aiRoutes;
