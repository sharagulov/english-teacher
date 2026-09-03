import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { todayKey } from '../lib/day.js';
import { MODE_MULTIPLIER, ANSWER_FORMAT_MULTIPLIER, choiceHintCost, computeReward, levelFromPoints, levelProgress, poolCompletionReward, type AnswerFormat, type LevelProgress, type PracticeMode, } from '../lib/economy.js';
import { levelsUpTo, type CefrLevel } from '../lib/levels.js';
import { applyAnswer, computePriority, initialState, reinsertGap, weightedSample, type SrsState, } from '../lib/srs.js';
import { matchAnswer, parseStringArray, type MatchType } from '../lib/text.js';
import { examplesForWord, prefetchExamples, type WordExampleView } from './examples.js';
import { awardPoints, bumpDailyStat, checkDailyGoal, grantAchievements, registerDailyActivity, spendPoints, type UnlockedAchievement } from './progress.js';
const DISLIKE_WEIGHT = [1, 0.2, 0.02] as const;
export function dislikeWeight(level: number): number {
    if (level <= 0)
        return DISLIKE_WEIGHT[0];
    if (level >= 2)
        return DISLIKE_WEIGHT[2];
    return DISLIKE_WEIGHT[1];
}
const NEW_WORD_RATIO: Record<PracticeMode, number> = {
    classic: 1,
    choice: 0.8,
    reverse: 0.3,
    listening: 0.3,
    sprint: 0.4,
    weak: 0,
    srs: 0,
    mixed: 0.5,
};
export function directionForMode(mode: PracticeMode): 'en_ru' | 'ru_en' | 'audio_en' {
    if (mode === 'reverse')
        return 'ru_en';
    if (mode === 'listening')
        return 'audio_en';
    return 'en_ru';
}
function parsePoolFilters(raw: string | null | undefined): PoolFilters {
    if (!raw)
        return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        const obj = parsed as Record<string, unknown>;
        const filters: PoolFilters = {};
        if (obj.direction === 'en_ru' || obj.direction === 'ru_en')
            filters.direction = obj.direction;
        if (obj.answerFormat === 'typed' || obj.answerFormat === 'choice')
            filters.answerFormat = obj.answerFormat;
        return filters;
    }
    catch {
        return {};
    }
}
function answerFormatFromFilters(filtersJson?: string | null): AnswerFormat {
    return parsePoolFilters(filtersJson).answerFormat ?? 'typed';
}
export function directionForPool(mode: PracticeMode, filtersJson?: string | null): 'en_ru' | 'ru_en' | 'audio_en' {
    if (mode === 'listening')
        return 'audio_en';
    if (mode === 'reverse')
        return 'ru_en';
    const fromFilters = parsePoolFilters(filtersJson).direction;
    if (fromFilters)
        return fromFilters;
    return directionForMode(mode);
}
export interface PoolFilters {
    levels?: CefrLevel[];
    topics?: string[];
    partsOfSpeech?: string[];
    direction?: 'en_ru' | 'ru_en';
    answerFormat?: AnswerFormat;
}
type WordRecord = Prisma.WordGetPayload<{}>;
function wordFilterForPool(levels: CefrLevel[], filters: PoolFilters) {
    return {
        isFunctionWord: false,
        level: { in: levels },
        ...(filters.topics?.length ? { topic: { in: filters.topics } } : {}),
        ...(filters.partsOfSpeech?.length ? { partOfSpeech: { in: filters.partsOfSpeech } } : {}),
    };
}
export interface CreatePoolInput {
    userId: string;
    mode: PracticeMode;
    size: number;
    filters?: PoolFilters;
}
async function selectNewWords(userId: string, levels: CefrLevel[], filters: PoolFilters, limit: number): Promise<WordRecord[]> {
    if (limit <= 0)
        return [];
    const candidates = await prisma.word.findMany({
        where: {
            ownerId: null,
            isFunctionWord: false,
            level: { in: levels },
            ...(filters.topics?.length ? { topic: { in: filters.topics } } : {}),
            ...(filters.partsOfSpeech?.length ? { partOfSpeech: { in: filters.partsOfSpeech } } : {}),
            userWords: { none: { userId } },
        },
        orderBy: [{ frequencyRank: { sort: 'asc', nulls: 'last' } }],
        take: limit * 6,
    });
    return weightedSample(candidates, limit, (word) => {
        const rank = word.frequencyRank ?? 10000;
        return 1 + (10000 - Math.min(rank, 10000)) / 2000;
    });
}
interface ReviewCandidate {
    word: WordRecord;
    userWord: Prisma.UserWordGetPayload<{}>;
    priority: number;
}
async function selectReviewWords(userId: string, levels: CefrLevel[], filters: PoolFilters, limit: number, options: {
    onlyDue?: boolean;
    onlyWeak?: boolean;
} = {}): Promise<ReviewCandidate[]> {
    if (limit <= 0)
        return [];
    const now = new Date();
    const wordFilter = wordFilterForPool(levels, filters);
    const base = {
        userId,
        isIgnored: false,
        word: wordFilter,
    };
    const [due, weak] = await Promise.all([
        options.onlyWeak
            ? []
            : prisma.userWord.findMany({
                where: { ...base, dueAt: { lte: now } },
                include: { word: true },
                orderBy: { dueAt: 'asc' },
                take: limit * 4,
            }),
        options.onlyDue
            ? []
            : prisma.userWord.findMany({
                where: { ...base, timesWrong: { gt: 0 } },
                include: { word: true },
                orderBy: { timesWrong: 'desc' },
                take: limit * 4,
            }),
    ]);
    const merged = new Map<number, ReviewCandidate>();
    for (const userWord of [...due, ...weak]) {
        if (merged.has(userWord.wordId))
            continue;
        const { word, ...rest } = userWord;
        merged.set(userWord.wordId, {
            word,
            userWord: rest,
            priority: computePriority({
                timesSeen: rest.timesSeen,
                timesWrong: rest.timesWrong,
                strength: rest.strength,
                status: rest.status,
                dueAt: rest.dueAt,
                frequencyRank: word.frequencyRank,
            }, now),
        });
    }
    const candidates = [...merged.values()];
    const preferred = candidates.filter((c) => c.userWord.dislikeLevel < 2);
    const rare = candidates.filter((c) => c.userWord.dislikeLevel >= 2);
    const eligible = preferred.length >= limit ? preferred : [...preferred, ...rare];
    return weightedSample(eligible, limit, (c) => Math.max(c.priority, 0.1) ** 1.5 * dislikeWeight(c.userWord.dislikeLevel));
}
async function selectPoolWords(input: CreatePoolInput, levels: CefrLevel[]): Promise<WordRecord[]> {
    const { userId, mode, size } = input;
    const filters = input.filters ?? {};
    const targetNew = Math.round(size * NEW_WORD_RATIO[mode]);
    const review = await selectReviewWords(userId, levels, filters, size - targetNew, {
        onlyDue: mode === 'srs',
        onlyWeak: mode === 'weak',
    });
    const reviewOnlyMode = mode === 'srs' || mode === 'weak';
    const newOnlyMode = mode === 'classic';
    let words = review.map((r) => r.word);
    if (!reviewOnlyMode) {
        const fresh = await selectNewWords(userId, levels, filters, size - words.length);
        words = [...words, ...fresh];
    }
    if (words.length < size && !reviewOnlyMode && !newOnlyMode) {
        const extra = await selectReviewWords(userId, levels, filters, size - words.length);
        for (const candidate of extra) {
            if (!words.some((w) => w.id === candidate.word.id))
                words.push(candidate.word);
        }
    }
    return shuffle(words).slice(0, size);
}
function shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
}
export async function createPool(input: CreatePoolInput) {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { cefrLevel: true },
    });
    const levels = input.filters?.levels?.length ? input.filters.levels : levelsUpTo(user.cefrLevel);
    const words = await selectPoolWords(input, levels);
    if (words.length === 0) {
        throw Object.assign(new Error('Не нашлось слов под выбранные условия. Попробуйте расширить фильтры.'), {
            statusCode: 422,
        });
    }
    await prisma.pool.updateMany({
        where: { userId: input.userId, status: 'active' },
        data: { status: 'abandoned' },
    });
    const ordinal = (await prisma.pool.count({ where: { userId: input.userId } })) + 1;
    const pool = await prisma.pool.create({
        data: {
            userId: input.userId,
            mode: input.mode,
            size: words.length,
            ordinal,
            filters: input.filters ? JSON.stringify(input.filters) : null,
            items: {
                create: words.map((word, index) => ({ wordId: word.id, position: index })),
            },
        },
    });
    prefetchExamples(words.map((word) => word.id));
    return getPoolState(input.userId, pool.id);
}
export interface Question {
    wordId: number;
    prompt: string;
    level: string;
    partOfSpeech: string | null;
    transcription: string | null;
    direction: 'en_ru' | 'ru_en' | 'audio_en';
    choices?: string[];
    answerLength: number;
    attemptsSoFar: number;
    isRetry: boolean;
    dislikeLevel: number;
    hintCost?: number;
    hintUsed?: boolean;
    canAffordHint?: boolean;
}
export interface PoolState {
    pool: {
        id: string;
        mode: PracticeMode;
        size: number;
        ordinal: number;
        status: string;
        correctCount: number;
        wrongCount: number;
        pointsEarned: number;
    };
    progress: {
        solved: number;
        total: number;
        remaining: number;
    };
    question: Question | null;
}
function primaryTranslation(word: WordRecord): string {
    return parseStringArray(word.translations)[0] ?? '';
}
function expectedAnswers(word: WordRecord, direction: Question['direction']): string[] {
    if (direction === 'en_ru')
        return parseStringArray(word.translations);
    return [word.text];
}
async function buildChoices(word: WordRecord, direction: Question['direction']): Promise<string[]> {
    const correct = direction === 'en_ru' ? primaryTranslation(word) : word.text;
    const distractors = await prisma.word.findMany({
        where: {
            ownerId: null,
            isFunctionWord: false,
            level: word.level,
            id: { not: word.id },
            ...(word.partOfSpeech ? { partOfSpeech: word.partOfSpeech } : {}),
        },
        take: 40,
        orderBy: { id: 'asc' },
    });
    const options = new Set<string>([correct]);
    for (const candidate of shuffle(distractors)) {
        if (options.size >= 4)
            break;
        const value = direction === 'en_ru' ? primaryTranslation(candidate) : candidate.text;
        if (value && value !== correct)
            options.add(value);
    }
    return shuffle([...options]);
}
function parseJsonStrings(raw: string | null | undefined): string[] | null {
    if (!raw)
        return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string'))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export async function getPoolState(userId: string, poolId: string): Promise<PoolState> {
    const pool = await prisma.pool.findFirstOrThrow({
        where: { id: poolId, userId },
        include: {
            items: {
                where: { solved: false },
                orderBy: { position: 'asc' },
                include: { word: true },
                take: 1,
            },
            _count: { select: { items: true } },
        },
    });
    const solved = await prisma.poolItem.count({ where: { poolId, solved: true } });
    const total = pool._count.items;
    const item = pool.items[0];
    const mode = pool.mode as PracticeMode;
    const direction = directionForPool(mode, pool.filters);
    const answerFormat = answerFormatFromFilters(pool.filters);
    const isChoice = answerFormat === 'choice' || mode === 'choice';
    let question: Question | null = null;
    if (item) {
        const word = item.word;
        const prompt = direction === 'en_ru' || direction === 'audio_en' ? word.text : primaryTranslation(word);
        const answers = expectedAnswers(word, direction);
        const ratingUser = await prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { points: true },
        });
        const cost = choiceHintCost(ratingUser.points);
        const progressRow = await prisma.userWord.findUnique({
            where: { userId_wordId: { userId, wordId: word.id } },
            select: { dislikeLevel: true },
        });
        let choices: string[] | undefined;
        if (isChoice) {
            choices = parseJsonStrings(item.choicesJson) ?? (await buildChoices(word, direction));
            if (!item.choicesJson) {
                await prisma.poolItem.update({
                    where: { id: item.id },
                    data: { choicesJson: JSON.stringify(choices) },
                });
            }
            const hidden = parseJsonStrings(item.hintHidden) ?? [];
            if (hidden.length > 0) {
                choices = choices.filter((option) => !hidden.includes(option));
            }
        }
        question = {
            wordId: word.id,
            prompt,
            level: word.level,
            partOfSpeech: word.partOfSpeech,
            transcription: word.transcription,
            direction,
            answerLength: answers[0]?.length ?? 0,
            attemptsSoFar: item.attempts,
            isRetry: item.wrongCount > 0,
            dislikeLevel: progressRow?.dislikeLevel ?? 0,
            ...(choices ? { choices } : {}),
            ...(isChoice
                ? {
                    hintCost: cost,
                    hintUsed: Boolean(item.hintHidden),
                    canAffordHint: ratingUser.points >= cost,
                }
                : {}),
        };
        await prisma.poolItem.update({ where: { id: item.id }, data: { lastShownAt: new Date() } });
    }
    return {
        pool: {
            id: pool.id,
            mode,
            size: pool.size,
            ordinal: pool.ordinal,
            status: pool.status,
            correctCount: pool.correctCount,
            wrongCount: pool.wrongCount,
            pointsEarned: pool.pointsEarned,
        },
        progress: { solved, total, remaining: total - solved },
        question,
    };
}
export interface SubmitAnswerInput {
    userId: string;
    poolId: string;
    wordId: number;
    answer: string;
    responseMs: number;
    hintsUsed: number;
    gaveUp?: boolean;
}
export interface AnswerResult {
    isCorrect: boolean;
    matchType: MatchType;
    correctAnswer: string;
    allAnswers: string[];
    matched: string | null;
    reward: {
        points: number;
        breakdown: {
            label: string;
            value: string;
        }[];
    };
    sessionStreak: number;
    wordProgress: {
        status: string;
        strength: number;
        timesSeen: number;
        timesCorrect: number;
        timesWrong: number;
        dislikeLevel: number;
    };
    rating: {
        points: number;
        level: number;
        leveledUp: boolean;
        freezesGranted: number;
        progress: LevelProgress;
    };
    poolCompleted: boolean;
    poolSummary?: {
        size: number;
        correct: number;
        wrong: number;
        accuracy: number;
        points: number;
        durationMs: number;
    };
    achievements: UnlockedAchievement[];
    dailyGoal: {
        reached: boolean;
        justCompleted: boolean;
        correct: number;
        goal: number;
    };
    word: {
        id: number;
        text: string;
        gloss: string | null;
        senses: {
            sense: string;
            translations: string[];
        }[];
        examples: WordExampleView[];
        level: string;
    };
    canUndo?: boolean;
}
interface UndoSnapshot {
    poolItem: {
        attempts: number;
        wrongCount: number;
        position: number;
        choicesJson: string | null;
        hintHidden: string | null;
    };
    pool: {
        wrongCount: number;
        pointsEarned: number;
        durationMs: number;
    };
    userWord: {
        existed: boolean;
        data: {
            timesSeen: number;
            timesCorrect: number;
            timesWrong: number;
            currentStreak: number;
            bestStreak: number;
            ease: number;
            intervalDays: number;
            repetitions: number;
            lapses: number;
            status: string;
            strength: number;
            hintsUsed: number;
            avgResponseMs: number;
            lastResult: boolean | null;
            lastSeenAt: string | null;
            firstSeenAt: string | null;
            learnedAt: string | null;
            masteredAt: string | null;
            dueAt: string;
        } | null;
    };
    dailyStat: {
        attempts: number;
        wrong: number;
        newWords: number;
        learned: number;
        mastered: number;
        points: number;
        timeMs: number;
    };
    pointsAwarded: number;
    transactionId: number | null;
}
export interface UndoResult {
    rating: {
        points: number;
        level: number;
        progress: LevelProgress;
    };
}
export async function submitAnswer(input: SubmitAnswerInput): Promise<AnswerResult> {
    const now = new Date();
    const [pool, item, user] = await Promise.all([
        prisma.pool.findFirstOrThrow({ where: { id: input.poolId, userId: input.userId } }),
        prisma.poolItem.findFirstOrThrow({
            where: { poolId: input.poolId, wordId: input.wordId },
            include: { word: true },
        }),
        prisma.user.findUniqueOrThrow({
            where: { id: input.userId },
            select: { typoTolerance: true, timezoneOffset: true },
        }),
    ]);
    if (pool.status !== 'active') {
        throw Object.assign(new Error('Этот пулл уже закрыт.'), { statusCode: 409 });
    }
    if (item.solved) {
        throw Object.assign(new Error('Слово в этом пулле уже отгадано.'), { statusCode: 409 });
    }
    const mode = pool.mode as PracticeMode;
    const direction = directionForPool(mode, pool.filters);
    const answerFormat = answerFormatFromFilters(pool.filters);
    const rewardMode = mode === 'choice' ? 'classic' : mode;
    const rewardFormat: AnswerFormat = mode === 'choice' ? 'choice' : answerFormat;
    const word = item.word;
    const answers = expectedAnswers(word, direction);
    const match = input.gaveUp
        ? { isCorrect: false, matchType: 'skipped' as const, matched: null }
        : matchAnswer(input.answer, answers, {
            allowTypos: user.typoTolerance,
            english: direction !== 'en_ru',
        });
    const existing = await prisma.userWord.findUnique({
        where: { userId_wordId: { userId: input.userId, wordId: word.id } },
    });
    const isFirstCorrect = match.isCorrect && (existing?.timesCorrect ?? 0) === 0;
    const isNewWord = existing == null;
    const previousState: SrsState = existing
        ? {
            timesSeen: existing.timesSeen,
            timesCorrect: existing.timesCorrect,
            timesWrong: existing.timesWrong,
            currentStreak: existing.currentStreak,
            bestStreak: existing.bestStreak,
            ease: existing.ease,
            intervalDays: existing.intervalDays,
            repetitions: existing.repetitions,
            lapses: existing.lapses,
            status: existing.status as SrsState['status'],
            strength: existing.strength,
            dueAt: existing.dueAt,
        }
        : initialState(now);
    const nextState = applyAnswer(previousState, {
        isCorrect: match.isCorrect,
        matchType: match.matchType,
        hintsUsed: input.hintsUsed,
        now,
    });
    const becameLearned = previousState.status !== 'review' && previousState.status !== 'mastered' && (nextState.status === 'review' || nextState.status === 'mastered');
    const becameMastered = previousState.status !== 'mastered' && nextState.status === 'mastered';
    const averageResponse = existing
        ? Math.round((existing.avgResponseMs * existing.timesSeen + input.responseMs) / (existing.timesSeen + 1))
        : input.responseMs;
    const responseMsCapped = Math.min(input.responseMs, 120000);
    const canUndo = !match.isCorrect && match.matchType !== 'skipped';
    const undoSnapshot: UndoSnapshot | null = canUndo
        ? {
            poolItem: {
                attempts: item.attempts,
                wrongCount: item.wrongCount,
                position: item.position,
                choicesJson: item.choicesJson,
                hintHidden: item.hintHidden,
            },
            pool: { wrongCount: pool.wrongCount, pointsEarned: pool.pointsEarned, durationMs: pool.durationMs },
            userWord: {
                existed: existing != null,
                data: existing
                    ? {
                        timesSeen: existing.timesSeen,
                        timesCorrect: existing.timesCorrect,
                        timesWrong: existing.timesWrong,
                        currentStreak: existing.currentStreak,
                        bestStreak: existing.bestStreak,
                        ease: existing.ease,
                        intervalDays: existing.intervalDays,
                        repetitions: existing.repetitions,
                        lapses: existing.lapses,
                        status: existing.status,
                        strength: existing.strength,
                        hintsUsed: existing.hintsUsed,
                        avgResponseMs: existing.avgResponseMs,
                        lastResult: existing.lastResult,
                        lastSeenAt: existing.lastSeenAt?.toISOString() ?? null,
                        firstSeenAt: existing.firstSeenAt?.toISOString() ?? null,
                        learnedAt: existing.learnedAt?.toISOString() ?? null,
                        masteredAt: existing.masteredAt?.toISOString() ?? null,
                        dueAt: existing.dueAt.toISOString(),
                    }
                    : null,
            },
            dailyStat: {
                attempts: 0,
                wrong: 0,
                newWords: 0,
                learned: 0,
                mastered: 0,
                points: 0,
                timeMs: 0,
            },
            pointsAwarded: 0,
            transactionId: null,
        }
        : null;
    await prisma.userWord.upsert({
        where: { userId_wordId: { userId: input.userId, wordId: word.id } },
        create: {
            userId: input.userId,
            wordId: word.id,
            ...srsToData(nextState),
            hintsUsed: input.hintsUsed,
            avgResponseMs: input.responseMs,
            lastResult: match.isCorrect,
            lastSeenAt: now,
            firstSeenAt: now,
            learnedAt: becameLearned ? now : null,
            masteredAt: becameMastered ? now : null,
        },
        update: {
            ...srsToData(nextState),
            hintsUsed: { increment: input.hintsUsed },
            avgResponseMs: averageResponse,
            lastResult: match.isCorrect,
            lastSeenAt: now,
            ...(becameLearned ? { learnedAt: now } : {}),
            ...(becameMastered ? { masteredAt: now } : {}),
        },
    });
    const sessionStreak = match.isCorrect ? await computeSessionStreak(input.userId, input.poolId) + 1 : 0;
    const reward = computeReward({
        level: word.level as CefrLevel,
        mode: rewardMode,
        answerFormat: rewardFormat,
        matchType: match.matchType,
        isCorrect: match.isCorrect,
        sessionStreak,
        responseMs: input.responseMs,
        hintsUsed: input.hintsUsed,
        isFirstCorrect,
    });
    if (match.isCorrect) {
        await prisma.poolItem.update({
            where: { id: item.id },
            data: { solved: true, solvedAt: now, attempts: { increment: 1 } },
        });
    }
    else {
        const remaining = await prisma.poolItem.count({ where: { poolId: pool.id, solved: false } });
        const maxPosition = await prisma.poolItem.aggregate({
            where: { poolId: pool.id, solved: false },
            _max: { position: true },
        });
        const gap = reinsertGap(remaining);
        await prisma.poolItem.update({
            where: { id: item.id },
            data: {
                attempts: { increment: 1 },
                wrongCount: { increment: 1 },
                position: (maxPosition._max.position ?? item.position) + gap,
                choicesJson: null,
                hintHidden: null,
            },
        });
    }
    await prisma.pool.update({
        where: { id: pool.id },
        data: {
            correctCount: match.isCorrect ? { increment: 1 } : undefined,
            wrongCount: match.isCorrect ? undefined : { increment: 1 },
            pointsEarned: { increment: reward.points },
            durationMs: { increment: responseMsCapped },
        },
    });
    const today = todayKey(user.timezoneOffset);
    await registerDailyActivity(input.userId);
    let award = await awardPoints(input.userId, {
        points: reward.points,
        reason: match.isCorrect ? 'correct_answer' : 'attempt',
        meta: { wordId: word.id, mode },
    });
    let freezesGranted = award.freezesGranted;
    let leveledUp = award.leveledUp;
    if (becameMastered) {
        const { MASTERY_REWARD } = await import('../lib/economy.js');
        award = await awardPoints(input.userId, {
            points: MASTERY_REWARD,
            reason: 'word_mastered',
            meta: { wordId: word.id },
        });
        freezesGranted += award.freezesGranted;
        leveledUp = leveledUp || award.leveledUp;
    }
    await bumpDailyStat(input.userId, today, {
        attempts: 1,
        correct: match.isCorrect ? 1 : 0,
        wrong: match.isCorrect ? 0 : 1,
        newWords: isNewWord ? 1 : 0,
        learned: becameLearned ? 1 : 0,
        mastered: becameMastered ? 1 : 0,
        points: reward.points,
        timeMs: responseMsCapped,
    });
    if (undoSnapshot) {
        undoSnapshot.dailyStat = {
            attempts: 1,
            wrong: 1,
            newWords: isNewWord ? 1 : 0,
            learned: becameLearned ? 1 : 0,
            mastered: becameMastered ? 1 : 0,
            points: reward.points,
            timeMs: responseMsCapped,
        };
        undoSnapshot.pointsAwarded = reward.points;
        undoSnapshot.transactionId = award.transactionId ?? null;
    }
    await prisma.attempt.create({
        data: {
            userId: input.userId,
            wordId: word.id,
            poolId: pool.id,
            mode,
            direction,
            question: direction === 'ru_en' ? primaryTranslation(word) : word.text,
            expected: answers[0] ?? '',
            given: input.answer,
            isCorrect: match.isCorrect,
            matchType: match.matchType,
            responseMs: input.responseMs,
            hintsUsed: input.hintsUsed,
            points: reward.points,
            undoSnapshot: undoSnapshot ? JSON.stringify(undoSnapshot) : null,
        },
    });
    const remaining = await prisma.poolItem.count({ where: { poolId: pool.id, solved: false } });
    let poolSummary: AnswerResult['poolSummary'];
    if (remaining === 0) {
        const finished = await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } });
        const bonus = poolCompletionReward(finished.size, finished.correctCount, finished.correctCount + finished.wrongCount);
        await prisma.pool.update({
            where: { id: pool.id },
            data: {
                status: 'completed',
                completedAt: now,
                pointsEarned: { increment: bonus.points },
            },
        });
        award = await awardPoints(input.userId, {
            points: bonus.points,
            reason: 'pool_complete',
            meta: { poolId: pool.id, accuracy: bonus.accuracy },
        });
        freezesGranted += award.freezesGranted;
        leveledUp = leveledUp || award.leveledUp;
        await bumpDailyStat(input.userId, today, { points: bonus.points, poolsDone: 1 });
        poolSummary = {
            size: finished.size,
            correct: finished.correctCount,
            wrong: finished.wrongCount,
            accuracy: bonus.accuracy,
            points: finished.pointsEarned + bonus.points,
            durationMs: finished.durationMs,
        };
    }
    const [dailyGoal, achievements, examples] = await Promise.all([
        checkDailyGoal(input.userId),
        grantAchievements(input.userId),
        examplesForWord(word.id),
    ]);
    return {
        isCorrect: match.isCorrect,
        matchType: match.matchType,
        correctAnswer: answers[0] ?? '',
        allAnswers: answers,
        matched: match.matched,
        reward: { points: reward.points, breakdown: reward.breakdown },
        sessionStreak,
        wordProgress: {
            status: nextState.status,
            strength: nextState.strength,
            timesSeen: nextState.timesSeen,
            timesCorrect: nextState.timesCorrect,
            timesWrong: nextState.timesWrong,
            dislikeLevel: existing?.dislikeLevel ?? 0,
        },
        rating: { points: award.total, level: award.level, leveledUp, freezesGranted, progress: levelProgress(award.total) },
        poolCompleted: remaining === 0,
        poolSummary,
        achievements,
        dailyGoal,
        word: {
            id: word.id,
            text: word.text,
            gloss: word.gloss,
            senses: parseSenses(word.senses),
            examples,
            level: word.level,
        },
        ...(canUndo ? { canUndo: true } : {}),
    };
}
function srsToData(state: SrsState) {
    return {
        timesSeen: state.timesSeen,
        timesCorrect: state.timesCorrect,
        timesWrong: state.timesWrong,
        currentStreak: state.currentStreak,
        bestStreak: state.bestStreak,
        ease: state.ease,
        intervalDays: state.intervalDays,
        repetitions: state.repetitions,
        lapses: state.lapses,
        status: state.status,
        strength: state.strength,
        dueAt: state.dueAt,
    };
}
export function parseSenses(raw: string | null): {
    sense: string;
    translations: string[];
}[] {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed
            .filter((s): s is {
            sense: string;
            translations: string[];
        } => typeof s?.sense === 'string' && Array.isArray(s?.translations))
            .slice(0, 4);
    }
    catch {
        return [];
    }
}
async function computeSessionStreak(userId: string, poolId: string): Promise<number> {
    const recent = await prisma.attempt.findMany({
        where: { userId, poolId },
        orderBy: { id: 'desc' },
        take: 60,
        select: { isCorrect: true },
    });
    let streak = 0;
    for (const attempt of recent) {
        if (!attempt.isCorrect)
            break;
        streak++;
    }
    return streak;
}
export async function buyChoiceHint(userId: string, poolId: string, wordId: number): Promise<{
    state: PoolState;
    spend: {
        cost: number;
        points: number;
        level: number;
        leveledDown: boolean;
        previousLevel: number;
        progress: LevelProgress;
    };
}> {
    const pool = await prisma.pool.findFirst({ where: { id: poolId, userId } });
    if (!pool || pool.status !== 'active') {
        throw Object.assign(new Error('Этот пулл уже закрыт.'), { statusCode: 409 });
    }
    if (answerFormatFromFilters(pool.filters) !== 'choice' && pool.mode !== 'choice') {
        throw Object.assign(new Error('Подсказка доступна только при ответе выбором варианта.'), { statusCode: 400 });
    }
    const current = await prisma.poolItem.findFirst({
        where: { poolId, solved: false },
        orderBy: { position: 'asc' },
        include: { word: true },
    });
    if (!current || current.wordId !== wordId) {
        throw Object.assign(new Error('Подсказка доступна только для текущего слова.'), { statusCode: 409 });
    }
    if (current.hintHidden) {
        const state = await getPoolState(userId, poolId);
        const user = await prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { points: true, level: true },
        });
        return {
            state,
            spend: {
                cost: 0,
                points: user.points,
                level: user.level,
                leveledDown: false,
                previousLevel: user.level,
                progress: levelProgress(user.points),
            },
        };
    }
    const direction = directionForPool(pool.mode as PracticeMode, pool.filters);
    let options = parseJsonStrings(current.choicesJson) ?? (await buildChoices(current.word, direction));
    if (!current.choicesJson) {
        await prisma.poolItem.update({
            where: { id: current.id },
            data: { choicesJson: JSON.stringify(options) },
        });
    }
    if (options.length < 4) {
        throw Object.assign(new Error('Для этого слова не набралось четырёх вариантов.'), { statusCode: 400 });
    }
    const correct = direction === 'en_ru' ? primaryTranslation(current.word) : current.word.text;
    const wrong = options.filter((option) => option !== correct);
    if (wrong.length < 3) {
        throw Object.assign(new Error('Недостаточно неверных вариантов для подсказки.'), { statusCode: 400 });
    }
    const hidden = shuffle(wrong).slice(0, 2);
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { points: true },
    });
    const cost = choiceHintCost(user.points);
    const spend = await spendPoints(userId, {
        points: cost,
        reason: 'choice_hint',
        meta: { poolId, wordId, hidden },
    });
    await prisma.poolItem.update({
        where: { id: current.id },
        data: { hintHidden: JSON.stringify(hidden) },
    });
    return {
        state: await getPoolState(userId, poolId),
        spend: {
            cost,
            points: spend.total,
            level: spend.level,
            leveledDown: spend.leveledDown,
            previousLevel: spend.previousLevel,
            progress: spend.progress,
        },
    };
}
export async function undoLastWrongAnswer(userId: string, poolId: string, wordId: number): Promise<{
    state: PoolState;
    undo: UndoResult;
}> {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezoneOffset: true },
    });
    const today = todayKey(user.timezoneOffset);
    await prisma.$transaction(async (tx) => {
        const pool = await tx.pool.findFirst({ where: { id: poolId, userId } });
        if (!pool || pool.status !== 'active') {
            throw Object.assign(new Error('Этот пулл уже закрыт.'), { statusCode: 409 });
        }
        const attempt = await tx.attempt.findFirst({
            where: {
                poolId,
                userId,
                wordId,
                isCorrect: false,
                matchType: { not: 'skipped' },
                undoneAt: null,
                undoSnapshot: { not: null },
            },
            orderBy: { id: 'desc' },
        });
        if (!attempt?.undoSnapshot) {
            throw Object.assign(new Error('Нечего отменять.'), { statusCode: 409 });
        }
        const latest = await tx.attempt.findFirst({
            where: { poolId, undoneAt: null },
            orderBy: { id: 'desc' },
            select: { id: true },
        });
        if (latest?.id !== attempt.id) {
            throw Object.assign(new Error('Отмена недоступна после перехода к следующему слову.'), { statusCode: 409 });
        }
        const snapshot = JSON.parse(attempt.undoSnapshot) as UndoSnapshot;
        const item = await tx.poolItem.findFirst({ where: { poolId, wordId } });
        if (!item || item.solved) {
            throw Object.assign(new Error('Слово уже отгадано в этом пулле.'), { statusCode: 409 });
        }
        await tx.poolItem.update({
            where: { id: item.id },
            data: {
                attempts: snapshot.poolItem.attempts,
                wrongCount: snapshot.poolItem.wrongCount,
                position: snapshot.poolItem.position,
                choicesJson: snapshot.poolItem.choicesJson ?? null,
                hintHidden: snapshot.poolItem.hintHidden ?? null,
            },
        });
        await tx.pool.update({
            where: { id: poolId },
            data: snapshot.pool,
        });
        if (snapshot.userWord.existed && snapshot.userWord.data) {
            const data = snapshot.userWord.data;
            await tx.userWord.update({
                where: { userId_wordId: { userId, wordId } },
                data: {
                    timesSeen: data.timesSeen,
                    timesCorrect: data.timesCorrect,
                    timesWrong: data.timesWrong,
                    currentStreak: data.currentStreak,
                    bestStreak: data.bestStreak,
                    ease: data.ease,
                    intervalDays: data.intervalDays,
                    repetitions: data.repetitions,
                    lapses: data.lapses,
                    status: data.status,
                    strength: data.strength,
                    hintsUsed: data.hintsUsed,
                    avgResponseMs: data.avgResponseMs,
                    lastResult: data.lastResult,
                    lastSeenAt: data.lastSeenAt ? new Date(data.lastSeenAt) : null,
                    firstSeenAt: data.firstSeenAt ? new Date(data.firstSeenAt) : null,
                    learnedAt: data.learnedAt ? new Date(data.learnedAt) : null,
                    masteredAt: data.masteredAt ? new Date(data.masteredAt) : null,
                    dueAt: new Date(data.dueAt),
                },
            });
        }
        else {
            await tx.userWord.deleteMany({ where: { userId, wordId } });
        }
        if (snapshot.pointsAwarded > 0) {
            const dbUser = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } });
            const total = Math.max(0, dbUser.points - snapshot.pointsAwarded);
            const level = levelFromPoints(total);
            await tx.user.update({
                where: { id: userId },
                data: { points: total, level },
            });
            if (snapshot.transactionId) {
                await tx.transaction.deleteMany({ where: { id: snapshot.transactionId, userId } });
            }
        }
        const stat = await tx.dailyStat.findUnique({ where: { userId_day: { userId, day: today } } });
        if (stat) {
            const clamp = (current: number, delta: number | undefined) => delta ? Math.max(0, current - delta) : current;
            const patch = snapshot.dailyStat;
            await tx.dailyStat.update({
                where: { userId_day: { userId, day: today } },
                data: {
                    attempts: clamp(stat.attempts, patch.attempts),
                    wrong: clamp(stat.wrong, patch.wrong),
                    newWords: clamp(stat.newWords, patch.newWords),
                    learned: clamp(stat.learned, patch.learned),
                    mastered: clamp(stat.mastered, patch.mastered),
                    points: clamp(stat.points, patch.points),
                    timeMs: clamp(stat.timeMs, patch.timeMs),
                },
            });
        }
        await tx.attempt.update({
            where: { id: attempt.id },
            data: { undoneAt: new Date() },
        });
    });
    const state = await getPoolState(userId, poolId);
    if (!state.question || state.question.wordId !== wordId) {
        throw Object.assign(new Error('Не удалось вернуть слово в очередь.'), { statusCode: 500 });
    }
    const ratingUser = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { points: true, level: true },
    });
    return {
        state,
        undo: {
            rating: {
                points: ratingUser.points,
                level: ratingUser.level,
                progress: levelProgress(ratingUser.points),
            },
        },
    };
}
export async function getActivePool(userId: string): Promise<PoolState | null> {
    const pool = await prisma.pool.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    if (!pool)
        return null;
    return getPoolState(userId, pool.id);
}
export async function abandonPool(userId: string, poolId: string): Promise<void> {
    await prisma.pool.updateMany({
        where: { id: poolId, userId, status: 'active' },
        data: { status: 'abandoned' },
    });
}
export async function countAvailable(userId: string, levels: CefrLevel[], filters: PoolFilters = {}) {
    const now = new Date();
    const wordFilter = wordFilterForPool(levels, filters);
    const [newWords, due, weak, total] = await Promise.all([
        prisma.word.count({
            where: { ownerId: null, ...wordFilter, userWords: { none: { userId } } },
        }),
        prisma.userWord.count({ where: { userId, isIgnored: false, dueAt: { lte: now }, word: wordFilter } }),
        prisma.userWord.count({ where: { userId, isIgnored: false, timesWrong: { gt: 0 }, word: wordFilter } }),
        prisma.word.count({ where: { ownerId: null, ...wordFilter } }),
    ]);
    return { newWords, due, weak, total, modeMultipliers: MODE_MULTIPLIER };
}
