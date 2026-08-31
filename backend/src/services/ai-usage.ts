import { prisma } from '../db.js';
import { aiPricingForModel, estimateAiCostUsd } from '../lib/ai-pricing.js';
import { todayKey } from '../lib/day.js';
import { env } from '../env.js';
export interface AiUsageSlice {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    costRub: number;
    requests: number;
}
function slice(inputTokens: number, outputTokens: number, costUsd: number, requests: number, usdRubRate: number): AiUsageSlice {
    return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd,
        costRub: costUsd * usdRubRate,
        requests,
    };
}
export async function recordAiUsage(userId: string, input: {
    inputTokens: number;
    outputTokens: number;
    model?: string;
}): Promise<void> {
    const inputTokens = Math.max(0, Math.round(input.inputTokens));
    const outputTokens = Math.max(0, Math.round(input.outputTokens));
    if (inputTokens === 0 && outputTokens === 0)
        return;
    const model = input.model ?? env.OPENAI_MODEL;
    const costUsd = estimateAiCostUsd(model, inputTokens, outputTokens);
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezoneOffset: true },
    });
    const day = todayKey(user.timezoneOffset);
    await prisma.$transaction([
        prisma.user.update({
            where: { id: userId },
            data: {
                aiInputTokens: { increment: inputTokens },
                aiOutputTokens: { increment: outputTokens },
                aiCostUsd: { increment: costUsd },
                aiRequests: { increment: 1 },
            },
        }),
        prisma.dailyStat.upsert({
            where: { userId_day: { userId, day } },
            update: {
                aiInputTokens: { increment: inputTokens },
                aiOutputTokens: { increment: outputTokens },
                aiCostUsd: { increment: costUsd },
            },
            create: {
                userId,
                day,
                aiInputTokens: inputTokens,
                aiOutputTokens: outputTokens,
                aiCostUsd: costUsd,
            },
        }),
    ]);
}
export async function getAiUsageOverview(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
            timezoneOffset: true,
            aiInputTokens: true,
            aiOutputTokens: true,
            aiCostUsd: true,
            aiRequests: true,
        },
    });
    const today = todayKey(user.timezoneOffset);
    const monthStart = `${today.slice(0, 7)}-01`;
    const usdRubRate = env.AI_USD_RUB_RATE;
    const pricing = aiPricingForModel(env.OPENAI_MODEL);
    const [monthRows, todayRow] = await Promise.all([
        prisma.dailyStat.findMany({
            where: { userId, day: { gte: monthStart, lte: today } },
            select: { aiInputTokens: true, aiOutputTokens: true, aiCostUsd: true },
        }),
        prisma.dailyStat.findUnique({
            where: { userId_day: { userId, day: today } },
            select: { aiInputTokens: true, aiOutputTokens: true, aiCostUsd: true },
        }),
    ]);
    const month = monthRows.reduce((acc, row) => ({
        inputTokens: acc.inputTokens + row.aiInputTokens,
        outputTokens: acc.outputTokens + row.aiOutputTokens,
        costUsd: acc.costUsd + row.aiCostUsd,
    }), { inputTokens: 0, outputTokens: 0, costUsd: 0 });
    const todayUsage = {
        inputTokens: todayRow?.aiInputTokens ?? 0,
        outputTokens: todayRow?.aiOutputTokens ?? 0,
        costUsd: todayRow?.aiCostUsd ?? 0,
    };
    return {
        enabled: env.aiEnabled,
        model: env.aiEnabled ? env.OPENAI_MODEL : null,
        pricing,
        monthReferenceUsd: 2,
        allTime: slice(user.aiInputTokens, user.aiOutputTokens, user.aiCostUsd, user.aiRequests, usdRubRate),
        month: slice(month.inputTokens, month.outputTokens, month.costUsd, 0, usdRubRate),
        today: slice(todayUsage.inputTokens, todayUsage.outputTokens, todayUsage.costUsd, 0, usdRubRate),
    };
}
