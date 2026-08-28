/**
 * Тренажёр слов: формирование пуллов, выдача вопросов, проверка ответов.
 *
 * Правила пулла (основной режим):
 *  • пулл — это набор из N слов;
 *  • верный ответ убирает слово из пулла и приносит монеты;
 *  • неверный — показывает правильный перевод, слово остаётся в пулле и
 *    вернётся позже, пока не будет отгадано;
 *  • когда слова заканчиваются, пулл закрывается и можно собрать новый.
 */
import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { todayKey } from '../lib/day.js';
import {
  MODE_MULTIPLIER,
  computeReward,
  poolCompletionReward,
  type PracticeMode,
} from '../lib/economy.js';
import { levelsUpTo, type CefrLevel } from '../lib/levels.js';
import {
  applyAnswer,
  computePriority,
  initialState,
  reinsertGap,
  weightedSample,
  type SrsState,
} from '../lib/srs.js';
import { matchAnswer, parseStringArray, type MatchType } from '../lib/text.js';
import { applyBalance, bumpDailyStat, checkDailyGoal, grantAchievements, registerDailyActivity, type UnlockedAchievement } from './progress.js';

/** Доля новых слов в пулле для каждого режима. */
const NEW_WORD_RATIO: Record<PracticeMode, number> = {
  classic: 0.75,
  choice: 0.8,
  reverse: 0.3,
  listening: 0.3,
  sprint: 0.4,
  weak: 0,
  srs: 0,
  mixed: 0.5,
};

/** В какую сторону переводим в данном режиме. */
export function directionForMode(mode: PracticeMode): 'en_ru' | 'ru_en' | 'audio_en' {
  if (mode === 'reverse') return 'ru_en';
  if (mode === 'listening') return 'audio_en';
  return 'en_ru';
}

export interface PoolFilters {
  levels?: CefrLevel[];
  topics?: string[];
  partsOfSpeech?: string[];
}

type WordRecord = Prisma.WordGetPayload<{}>;

export interface CreatePoolInput {
  userId: string;
  mode: PracticeMode;
  size: number;
  filters?: PoolFilters;
}

// ─────────────────────────────── Отбор слов ───────────────────────────────

/** Новые слова: те, которых пользователь ещё не видел. Сначала самые частотные. */
async function selectNewWords(userId: string, levels: CefrLevel[], filters: PoolFilters, limit: number): Promise<WordRecord[]> {
  if (limit <= 0) return [];

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

  // Из частотной «головы» выбираем случайно, чтобы пуллы не повторялись,
  // но с перевесом в пользу более частотных слов.
  return weightedSample(candidates, limit, (word) => {
    const rank = word.frequencyRank ?? 10_000;
    return 1 + (10_000 - Math.min(rank, 10_000)) / 2_000;
  });
}

interface ReviewCandidate {
  word: WordRecord;
  userWord: Prisma.UserWordGetPayload<{}>;
  priority: number;
}

/** Слова на повторение: просроченные и те, где больше всего ошибок. */
async function selectReviewWords(
  userId: string,
  levels: CefrLevel[],
  filters: PoolFilters,
  limit: number,
  options: { onlyDue?: boolean; onlyWeak?: boolean } = {},
): Promise<ReviewCandidate[]> {
  if (limit <= 0) return [];

  const now = new Date();
  const wordFilter = {
    isFunctionWord: false,
    level: { in: levels },
    ...(filters.topics?.length ? { topic: { in: filters.topics } } : {}),
    ...(filters.partsOfSpeech?.length ? { partOfSpeech: { in: filters.partsOfSpeech } } : {}),
  };

  const base = {
    userId,
    isIgnored: false,
    word: wordFilter,
  };

  // Два независимых запроса по индексам: «пора повторить» и «часто ошибаюсь».
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
    if (merged.has(userWord.wordId)) continue;
    const { word, ...rest } = userWord;
    merged.set(userWord.wordId, {
      word,
      userWord: rest,
      priority: computePriority(
        {
          timesSeen: rest.timesSeen,
          timesWrong: rest.timesWrong,
          strength: rest.strength,
          status: rest.status,
          dueAt: rest.dueAt,
          frequencyRank: word.frequencyRank,
        },
        now,
      ),
    });
  }

  const candidates = [...merged.values()];
  return weightedSample(candidates, limit, (c) => Math.max(c.priority, 0.1) ** 1.5);
}

/** Собирает состав пулла под выбранный режим. */
async function selectPoolWords(input: CreatePoolInput, levels: CefrLevel[]): Promise<WordRecord[]> {
  const { userId, mode, size } = input;
  const filters = input.filters ?? {};

  const targetNew = Math.round(size * NEW_WORD_RATIO[mode]);

  const review = await selectReviewWords(userId, levels, filters, size - targetNew, {
    onlyDue: mode === 'srs',
    onlyWeak: mode === 'weak',
  });

  // Если повторять пока нечего, добираем состав новыми словами.
  const newCount = size - review.length;
  const fresh = await selectNewWords(userId, levels, filters, newCount);

  const words = [...review.map((r) => r.word), ...fresh];

  // Режимам «повторение» и «слабые слова» новые слова не подмешиваем,
  // но если база пуста, лучше показать хоть что-то, чем пустой экран.
  if (words.length < size && mode !== 'srs' && mode !== 'weak') {
    const extra = await selectReviewWords(userId, levels, filters, size - words.length);
    for (const candidate of extra) {
      if (!words.some((w) => w.id === candidate.word.id)) words.push(candidate.word);
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

// ─────────────────────────────── Создание пулла ───────────────────────────────

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

  // Незакрытые пуллы того же режима помечаем брошенными: одновременно
  // активным должен быть только один.
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

  return getPoolState(input.userId, pool.id);
}

// ─────────────────────────────── Выдача вопроса ───────────────────────────────

export interface Question {
  wordId: number;
  /** Что показываем пользователю. */
  prompt: string;
  /** Подпись под заданием: часть речи, уровень. */
  level: string;
  partOfSpeech: string | null;
  transcription: string | null;
  direction: 'en_ru' | 'ru_en' | 'audio_en';
  /** Для режима выбора — варианты ответа. */
  choices?: string[];
  /** Сколько символов в ожидаемом ответе — рисуем «рамку» под ввод. */
  answerLength: number;
  attemptsSoFar: number;
  /** Слово уже встречалось в этом пулле и было отвечено неверно. */
  isRetry: boolean;
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
    coinsEarned: number;
    xpEarned: number;
  };
  progress: { solved: number; total: number; remaining: number };
  question: Question | null;
}

function primaryTranslation(word: WordRecord): string {
  return parseStringArray(word.translations)[0] ?? '';
}

/** Ожидаемые варианты ответа для режима. */
function expectedAnswers(word: WordRecord, direction: Question['direction']): string[] {
  if (direction === 'en_ru') return parseStringArray(word.translations);
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
    if (options.size >= 4) break;
    const value = direction === 'en_ru' ? primaryTranslation(candidate) : candidate.text;
    if (value && value !== correct) options.add(value);
  }

  return shuffle([...options]);
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
  const direction = directionForMode(mode);

  let question: Question | null = null;

  if (item) {
    const word = item.word;
    const prompt = direction === 'en_ru' || direction === 'audio_en' ? word.text : primaryTranslation(word);
    const answers = expectedAnswers(word, direction);

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
      ...(mode === 'choice' ? { choices: await buildChoices(word, direction) } : {}),
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
      coinsEarned: pool.coinsEarned,
      xpEarned: pool.xpEarned,
    },
    progress: { solved, total, remaining: total - solved },
    question,
  };
}

// ─────────────────────────────── Проверка ответа ───────────────────────────────

export interface SubmitAnswerInput {
  userId: string;
  poolId: string;
  wordId: number;
  answer: string;
  responseMs: number;
  hintsUsed: number;
}

export interface AnswerResult {
  isCorrect: boolean;
  matchType: MatchType;
  /** Правильный ответ — показываем всегда, и при ошибке, и при успехе. */
  correctAnswer: string;
  allAnswers: string[];
  matched: string | null;
  reward: { coins: number; xp: number; breakdown: { label: string; value: string }[] };
  sessionStreak: number;
  wordProgress: { status: string; strength: number; timesSeen: number; timesCorrect: number; timesWrong: number };
  balance: { coins: number; xp: number; level: number; leveledUp: boolean };
  poolCompleted: boolean;
  poolSummary?: { size: number; correct: number; wrong: number; accuracy: number; coins: number; xp: number; durationMs: number };
  achievements: UnlockedAchievement[];
  dailyGoal: { reached: boolean; justCompleted: boolean; correct: number; goal: number };
  /** Пояснение и значения — чтобы сразу закрепить слово. */
  word: { text: string; gloss: string | null; senses: { sense: string; translations: string[] }[]; level: string };
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
  const direction = directionForMode(mode);
  const word = item.word;
  const answers = expectedAnswers(word, direction);

  const match = matchAnswer(input.answer, answers, {
    allowTypos: user.typoTolerance,
    english: direction !== 'en_ru',
  });

  // ── Состояние слова в модели памяти ──
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

  // ── Серия верных ответов внутри сессии ──
  const sessionStreak = match.isCorrect ? await computeSessionStreak(input.userId, input.poolId) + 1 : 0;

  const reward = computeReward({
    level: word.level as CefrLevel,
    mode,
    matchType: match.matchType,
    isCorrect: match.isCorrect,
    sessionStreak,
    responseMs: input.responseMs,
    hintsUsed: input.hintsUsed,
    isFirstCorrect,
  });

  // ── Запись попытки ──
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
      coins: reward.coins,
      xp: reward.xp,
    },
  });

  // ── Обновление пулла ──
  if (match.isCorrect) {
    await prisma.poolItem.update({
      where: { id: item.id },
      data: { solved: true, solvedAt: now, attempts: { increment: 1 } },
    });
  } else {
    // Слово возвращается в очередь: не следующим же вопросом, но и не в конец.
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
      },
    });
  }

  await prisma.pool.update({
    where: { id: pool.id },
    data: {
      correctCount: match.isCorrect ? { increment: 1 } : undefined,
      wrongCount: match.isCorrect ? undefined : { increment: 1 },
      coinsEarned: { increment: reward.coins },
      xpEarned: { increment: reward.xp },
      durationMs: { increment: Math.min(input.responseMs, 120_000) },
    },
  });

  // ── Начисления ──
  const today = todayKey(user.timezoneOffset);
  await registerDailyActivity(input.userId);

  let balance = await applyBalance(input.userId, {
    coins: reward.coins,
    xp: reward.xp,
    reason: match.isCorrect ? 'correct_answer' : 'attempt',
    meta: { wordId: word.id, mode },
  });

  if (becameMastered) {
    const { MASTERY_REWARD } = await import('../lib/economy.js');
    balance = await applyBalance(input.userId, {
      ...MASTERY_REWARD,
      reason: 'word_mastered',
      meta: { wordId: word.id },
    });
  }

  await bumpDailyStat(input.userId, today, {
    attempts: 1,
    correct: match.isCorrect ? 1 : 0,
    wrong: match.isCorrect ? 0 : 1,
    newWords: isNewWord ? 1 : 0,
    learned: becameLearned ? 1 : 0,
    mastered: becameMastered ? 1 : 0,
    coins: reward.coins,
    xp: reward.xp,
    timeMs: Math.min(input.responseMs, 120_000),
  });

  // ── Завершение пулла ──
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
        coinsEarned: { increment: bonus.coins },
        xpEarned: { increment: bonus.xp },
      },
    });

    balance = await applyBalance(input.userId, {
      coins: bonus.coins,
      xp: bonus.xp,
      reason: 'pool_complete',
      meta: { poolId: pool.id, accuracy: bonus.accuracy },
    });

    await bumpDailyStat(input.userId, today, { coins: bonus.coins, xp: bonus.xp, poolsDone: 1 });

    poolSummary = {
      size: finished.size,
      correct: finished.correctCount,
      wrong: finished.wrongCount,
      accuracy: bonus.accuracy,
      coins: finished.coinsEarned + bonus.coins,
      xp: finished.xpEarned + bonus.xp,
      durationMs: finished.durationMs,
    };
  }

  const [dailyGoal, achievements] = await Promise.all([
    checkDailyGoal(input.userId),
    grantAchievements(input.userId),
  ]);

  return {
    isCorrect: match.isCorrect,
    matchType: match.matchType,
    correctAnswer: answers[0] ?? '',
    allAnswers: answers,
    matched: match.matched,
    reward: { coins: reward.coins, xp: reward.xp, breakdown: reward.breakdown },
    sessionStreak,
    wordProgress: {
      status: nextState.status,
      strength: nextState.strength,
      timesSeen: nextState.timesSeen,
      timesCorrect: nextState.timesCorrect,
      timesWrong: nextState.timesWrong,
    },
    balance: { coins: balance.balance, xp: balance.xp, level: balance.level, leveledUp: balance.leveledUp },
    poolCompleted: remaining === 0,
    poolSummary,
    achievements,
    dailyGoal,
    word: {
      text: word.text,
      gloss: word.gloss,
      senses: parseSenses(word.senses),
      level: word.level,
    },
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

export function parseSenses(raw: string | null): { sense: string; translations: string[] }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is { sense: string; translations: string[] } => typeof s?.sense === 'string' && Array.isArray(s?.translations))
      .slice(0, 4);
  } catch {
    return [];
  }
}

/** Длина текущей серии верных ответов подряд в рамках пулла. */
async function computeSessionStreak(userId: string, poolId: string): Promise<number> {
  const recent = await prisma.attempt.findMany({
    where: { userId, poolId },
    orderBy: { id: 'desc' },
    take: 60,
    select: { isCorrect: true },
  });

  let streak = 0;
  for (const attempt of recent) {
    if (!attempt.isCorrect) break;
    streak++;
  }
  return streak;
}

// ─────────────────────────────── Подсказки ───────────────────────────────

export interface HintResult {
  kind: string;
  value: string;
  cost: number;
  balance: number;
}

export async function buyHint(
  userId: string,
  poolId: string,
  wordId: number,
  kind: 'letter' | 'gloss' | 'length' | 'choices',
): Promise<HintResult> {
  const { HINT_COSTS } = await import('../lib/economy.js');
  const cost = HINT_COSTS[kind];

  const [user, pool, word] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coins: true } }),
    prisma.pool.findFirstOrThrow({ where: { id: poolId, userId }, select: { mode: true } }),
    prisma.word.findUniqueOrThrow({ where: { id: wordId } }),
  ]);

  if (user.coins < cost) {
    throw Object.assign(new Error('Не хватает монет на подсказку.'), { statusCode: 402 });
  }

  const direction = directionForMode(pool.mode as PracticeMode);
  const answers = expectedAnswers(word, direction);
  const answer = answers[0] ?? '';

  let value: string;
  switch (kind) {
    case 'length':
      value = `${answer.length} символов`;
      break;
    case 'letter':
      value = answer.slice(0, 1);
      break;
    case 'gloss':
      value = word.gloss ?? word.senses ?? 'Пояснение недоступно для этого слова';
      break;
    case 'choices': {
      value = (await buildChoices(word, direction)).join(' · ');
      break;
    }
  }

  const balance = await applyBalance(userId, { coins: -cost, reason: `hint:${kind}`, meta: { wordId } });

  return { kind, value, cost, balance: balance.balance };
}

// ─────────────────────────────── Прочее ───────────────────────────────

/** Активный пулл пользователя, если он есть. */
export async function getActivePool(userId: string): Promise<PoolState | null> {
  const pool = await prisma.pool.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!pool) return null;
  return getPoolState(userId, pool.id);
}

/** Отказ от пулла без завершения. */
export async function abandonPool(userId: string, poolId: string): Promise<void> {
  await prisma.pool.updateMany({
    where: { id: poolId, userId, status: 'active' },
    data: { status: 'abandoned' },
  });
}

/** Сколько слов доступно под заданные условия — для экрана выбора режима. */
export async function countAvailable(userId: string, levels: CefrLevel[]) {
  const now = new Date();
  const [newWords, due, weak, total] = await Promise.all([
    prisma.word.count({
      where: { ownerId: null, isFunctionWord: false, level: { in: levels }, userWords: { none: { userId } } },
    }),
    prisma.userWord.count({ where: { userId, isIgnored: false, dueAt: { lte: now }, word: { level: { in: levels } } } }),
    prisma.userWord.count({ where: { userId, isIgnored: false, timesWrong: { gt: 0 }, word: { level: { in: levels } } } }),
    prisma.word.count({ where: { ownerId: null, isFunctionWord: false, level: { in: levels } } }),
  ]);

  return { newWords, due, weak, total, modeMultipliers: MODE_MULTIPLIER };
}
