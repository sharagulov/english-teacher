/**
 * Тренажёр слов: формирование пуллов, выдача вопросов, проверка ответов.
 *
 * Правила пулла (основной режим):
 *  • пулл — это набор из N слов;
 *  • верный ответ убирает слово из пулла и приносит очки рейтинга;
 *  • неверный или «не знаю» — показывает правильный перевод, слово остаётся
 *    в пулле и вернётся позже, пока не будет отгадано;
 *  • когда слова заканчиваются, пулл закрывается и можно собрать новый.
 */
import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { todayKey } from '../lib/day.js';
import {
  MODE_MULTIPLIER,
  computeReward,
  levelProgress,
  poolCompletionReward,
  type LevelProgress,
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
import { examplesForWord, prefetchExamples, type WordExampleView } from './examples.js';
import { awardPoints, bumpDailyStat, checkDailyGoal, grantAchievements, registerDailyActivity, type UnlockedAchievement } from './progress.js';

/** Множитель веса в пулле по dislikeLevel: 0 — как обычно, 1 — реже, 2 — почти никогда. */
const DISLIKE_WEIGHT = [1, 0.2, 0.02] as const;

export function dislikeWeight(level: number): number {
  if (level <= 0) return DISLIKE_WEIGHT[0];
  if (level >= 2) return DISLIKE_WEIGHT[2];
  return DISLIKE_WEIGHT[1];
}

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
  const preferred = candidates.filter((c) => c.userWord.dislikeLevel < 2);
  const rare = candidates.filter((c) => c.userWord.dislikeLevel >= 2);
  // Уровень 2 почти не берём: только если иначе пулл недоберётся.
  const eligible = preferred.length >= limit ? preferred : [...preferred, ...rare];
  return weightedSample(eligible, limit, (c) => Math.max(c.priority, 0.1) ** 1.5 * dislikeWeight(c.userWord.dislikeLevel));
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

  // Примеры употребления готовим фоном: к моменту первого разбора они уже
  // будут в базе, а ответ на создание пулла эту работу не ждёт.
  prefetchExamples(words.map((word) => word.id));

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
  /** 0 — обычная выдача, 1 — реже, 2 — почти не показывать. */
  dislikeLevel: number;
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

    const [choices, progressRow] = await Promise.all([
      mode === 'choice' ? buildChoices(word, direction) : Promise.resolve(undefined),
      prisma.userWord.findUnique({
        where: { userId_wordId: { userId, wordId: word.id } },
        select: { dislikeLevel: true },
      }),
    ]);

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

// ─────────────────────────────── Проверка ответа ───────────────────────────────

export interface SubmitAnswerInput {
  userId: string;
  poolId: string;
  wordId: number;
  answer: string;
  responseMs: number;
  hintsUsed: number;
  /** «Не знаю»: раскрыть ответ и засчитать промах, не выдавая ложный вариант. */
  gaveUp?: boolean;
}

export interface AnswerResult {
  isCorrect: boolean;
  matchType: MatchType;
  /** Правильный ответ — показываем всегда, и при ошибке, и при успехе. */
  correctAnswer: string;
  allAnswers: string[];
  matched: string | null;
  reward: { points: number; breakdown: { label: string; value: string }[] };
  sessionStreak: number;
  wordProgress: {
    status: string;
    strength: number;
    timesSeen: number;
    timesCorrect: number;
    timesWrong: number;
    dislikeLevel: number;
  };
  /** Рейтинг и уровень после начисления — интерфейс обновляет их без лишнего запроса. */
  rating: { points: number; level: number; leveledUp: boolean; freezesGranted: number; progress: LevelProgress };
  poolCompleted: boolean;
  poolSummary?: { size: number; correct: number; wrong: number; accuracy: number; points: number; durationMs: number };
  achievements: UnlockedAchievement[];
  dailyGoal: { reached: boolean; justCompleted: boolean; correct: number; goal: number };
  /** Пояснение, примеры и значения — чтобы сразу закрепить слово. */
  word: {
    id: number;
    text: string;
    gloss: string | null;
    senses: { sense: string; translations: string[] }[];
    examples: WordExampleView[];
    level: string;
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
  const direction = directionForMode(mode);
  const word = item.word;
  const answers = expectedAnswers(word, direction);

  const match = input.gaveUp
    ? { isCorrect: false, matchType: 'skipped' as const, matched: null }
    : matchAnswer(input.answer, answers, {
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
      points: reward.points,
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
      pointsEarned: { increment: reward.points },
      durationMs: { increment: Math.min(input.responseMs, 120_000) },
    },
  });

  // ── Начисления ──
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
