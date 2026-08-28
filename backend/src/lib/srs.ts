/**
 * Интервальное повторение и приоритет выдачи слов.
 *
 * За основу взят SM-2, но с двумя доработками под задачу:
 *  1. Учитывается тип совпадения: ответ с опечаткой продвигает слово слабее,
 *     чем уверенно точный.
 *  2. Отдельно считается «давление ошибок» — слова, на которых пользователь
 *     ошибается чаще всего, поднимаются в очереди. Именно это делает выдачу
 *     адаптивной, а не случайной.
 */
import type { MatchType } from './text.js';

export type WordStatus = 'new' | 'learning' | 'review' | 'mastered' | 'leech';

const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SrsState {
  timesSeen: number;
  timesCorrect: number;
  timesWrong: number;
  currentStreak: number;
  bestStreak: number;
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  status: WordStatus;
  strength: number;
  dueAt: Date;
}

export interface SrsUpdateInput {
  isCorrect: boolean;
  matchType: MatchType;
  hintsUsed: number;
  now?: Date;
}

/** Начальное состояние слова, которое пользователь видит впервые. */
export function initialState(now = new Date()): SrsState {
  return {
    timesSeen: 0,
    timesCorrect: 0,
    timesWrong: 0,
    currentStreak: 0,
    bestStreak: 0,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    status: 'new',
    strength: 0,
    dueAt: now,
  };
}

/**
 * Оценка освоенности слова, 0..1.
 * Складывается из числа успешных повторений подряд и общей точности,
 * с поправкой на количество «провалов» после успеха.
 */
export function computeStrength(state: Pick<SrsState, 'repetitions' | 'timesSeen' | 'timesCorrect' | 'lapses'>): number {
  if (state.timesSeen === 0) return 0;
  const accuracy = state.timesCorrect / state.timesSeen;
  const repetitionScore = Math.min(state.repetitions, 5) / 5;
  const lapsePenalty = Math.min(state.lapses * 0.06, 0.3);
  return Math.max(0, Math.min(1, repetitionScore * 0.6 + accuracy * 0.4 - lapsePenalty));
}

function resolveStatus(state: Omit<SrsState, 'status'>): WordStatus {
  const accuracy = state.timesSeen > 0 ? state.timesCorrect / state.timesSeen : 0;
  if (state.timesSeen === 0) return 'new';
  if (state.lapses >= 5 && accuracy < 0.5) return 'leech';
  if (state.repetitions >= 5 && state.intervalDays >= 21 && accuracy >= 0.85) return 'mastered';
  if (state.repetitions >= 2) return 'review';
  return 'learning';
}

/** Пересчитывает состояние слова после ответа. */
export function applyAnswer(previous: SrsState, input: SrsUpdateInput): SrsState {
  const now = input.now ?? new Date();
  const state: Omit<SrsState, 'status'> = { ...previous };

  state.timesSeen = previous.timesSeen + 1;

  if (input.isCorrect) {
    state.timesCorrect = previous.timesCorrect + 1;
    state.currentStreak = previous.currentStreak + 1;
    state.bestStreak = Math.max(previous.bestStreak, state.currentStreak);
    state.repetitions = previous.repetitions + 1;

    // Уверенный ответ без подсказок укрепляет фактор легкости, с опечаткой — нет.
    const confident = input.matchType === 'exact' && input.hintsUsed === 0;
    state.ease = clampEase(previous.ease + (confident ? 0.05 : input.matchType === 'typo' ? -0.05 : 0));

    const growth = input.matchType === 'typo' ? 0.6 : 1;
    if (state.repetitions === 1) state.intervalDays = 1;
    else if (state.repetitions === 2) state.intervalDays = 3;
    else state.intervalDays = Math.min(previous.intervalDays * state.ease * growth, 365);

    // Подсказки сокращают интервал: слово вспомнили не самостоятельно.
    if (input.hintsUsed > 0) state.intervalDays = Math.max(1, state.intervalDays / (1 + input.hintsUsed));
  } else {
    state.timesWrong = previous.timesWrong + 1;
    state.currentStreak = 0;
    if (previous.repetitions >= 2) state.lapses = previous.lapses + 1;
    state.repetitions = 0;
    state.ease = clampEase(previous.ease - 0.2);
    state.intervalDays = 0;
  }

  state.dueAt = new Date(now.getTime() + state.intervalDays * DAY_MS);
  state.strength = computeStrength(state);

  return { ...state, status: resolveStatus(state) };
}

function clampEase(value: number): number {
  return Math.max(MIN_EASE, Math.min(MAX_EASE, value));
}

export interface PriorityInput {
  timesSeen: number;
  timesWrong: number;
  strength: number;
  status: string;
  dueAt: Date;
  frequencyRank: number | null;
}

/**
 * Приоритет слова в очереди повторения. Чем выше — тем нужнее показать.
 *
 * Слагаемые:
 *  • просрочка — насколько давно слово пора было повторить;
 *  • давление ошибок — абсолютное число промахов и их доля;
 *  • штраф за освоенность — хорошо выученное слово уходит вниз;
 *  • бонус частотности — частотное слово полезнее редкого;
 *  • отдельный подъём для «залипших» слов, на которых пользователь стабильно спотыкается.
 */
export function computePriority(input: PriorityInput, now = new Date()): number {
  const overdueDays = Math.min(Math.max((now.getTime() - input.dueAt.getTime()) / DAY_MS, 0), 30);
  const errorRate = input.timesWrong / Math.max(input.timesSeen, 1);
  const frequencyBoost = 1 - Math.min(input.frequencyRank ?? 10_000, 10_000) / 10_000;

  let priority = overdueDays * 2 + input.timesWrong * 3 + errorRate * 12 - input.strength * 14 + frequencyBoost * 3;

  if (input.status === 'leech') priority += 8;
  if (input.status === 'mastered') priority -= 10;

  return priority;
}

/**
 * Взвешенная выборка без повторов: элементы с большим весом выпадают чаще,
 * но результат остаётся случайным — иначе пуллы были бы одинаковыми.
 */
export function weightedSample<T>(items: T[], count: number, weightOf: (item: T) => number): T[] {
  const pool = items.map((item) => ({ item, weight: Math.max(weightOf(item), 0.0001) }));
  const picked: T[] = [];

  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = Math.random() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      threshold -= pool[i]!.weight;
      if (threshold <= 0) {
        index = i;
        break;
      }
    }
    picked.push(pool[index]!.item);
    pool.splice(index, 1);
  }

  return picked;
}

/**
 * Позиция, на которую возвращается неотгаданное слово: не сразу же следующим,
 * чтобы ответ не был свежим в памяти, но и не в самый конец.
 */
export function reinsertGap(remaining: number): number {
  if (remaining <= 2) return remaining;
  return Math.min(remaining, 2 + Math.floor(Math.random() * 3));
}
