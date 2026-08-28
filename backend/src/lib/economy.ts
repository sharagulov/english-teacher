/**
 * Экономика приложения: очки рейтинга, уровни, серии.
 *
 * Принципы:
 *  • Единая величина прогресса — очки рейтинга. Они задают уровень.
 *    Тратить их можно только на платную подсказку в режиме «Выбор варианта»;
 *    если после траты очков не хватает на текущий уровень — он понижается.
 *  • За ошибку очки не отнимаются — наказание только в потере множителя серии,
 *    иначе заниматься становится страшно.
 *  • Награда растёт за сложность (уровень слова, режим) и за скорость.
 *  • Первый верный ответ на новое слово даёт удвоенную награду — это делает
 *    расширение словаря выгоднее, чем перебор уже знакомых слов.
 */
import type { MatchType } from './text.js';
import type { CefrLevel } from './levels.js';

export type PracticeMode = 'classic' | 'reverse' | 'choice' | 'listening' | 'sprint' | 'weak' | 'srs' | 'mixed';

export const PRACTICE_MODES: PracticeMode[] = ['classic', 'reverse', 'choice', 'listening', 'sprint', 'weak', 'srs', 'mixed'];

/** Базовая награда за слово в зависимости от его уровня. */
const BASE_BY_LEVEL: Record<CefrLevel, number> = {
  A1: 6,
  A2: 8,
  B1: 11,
  B2: 14,
  C1: 18,
  C2: 22,
};

/** Насколько режим сложнее классического — на это множится награда. */
export const MODE_MULTIPLIER: Record<PracticeMode, number> = {
  classic: 1,
  reverse: 1.3,
  choice: 0.6,
  listening: 1.4,
  sprint: 0.9,
  weak: 1.2,
  srs: 1.1,
  mixed: 1.1,
};

export const MODE_LABELS: Record<PracticeMode, string> = {
  classic: 'Новые слова',
  reverse: 'С русского',
  choice: 'Выбор варианта',
  listening: 'На слух',
  sprint: 'Спринт',
  weak: 'Слабые слова',
  srs: 'Повторение',
  mixed: 'Микс',
};

/**
 * Режим открывается по достижении игрового уровня.
 * Повторение доступно сразу: без него изученное просто забывается.
 */
export const MODE_UNLOCK_LEVEL: Record<PracticeMode, number> = {
  classic: 1,
  choice: 1,
  srs: 1,
  reverse: 2,
  weak: 2,
  listening: 3,
  sprint: 4,
  mixed: 5,
};

export interface RewardInput {
  level: CefrLevel;
  mode: PracticeMode;
  matchType: MatchType;
  isCorrect: boolean;
  /** Серия верных ответов подряд внутри сессии (уже включая текущий). */
  sessionStreak: number;
  responseMs: number;
  hintsUsed: number;
  /** Первый в жизни верный ответ на это слово. */
  isFirstCorrect: boolean;
}

export interface Reward {
  points: number;
  /** Разбор начисления — показывается в интерфейсе, чтобы правила были прозрачны. */
  breakdown: { label: string; value: string }[];
  streakMultiplier: number;
}

/** Множитель за серию: каждые 3 верных ответа +15%, максимум ×2. */
export function streakMultiplier(sessionStreak: number): number {
  return 1 + Math.min(Math.floor(sessionStreak / 3) * 0.15, 1);
}

/** Каждая подсказка оставляет от награды только эту долю. */
export const HINT_REWARD_FACTOR = 0.6;

export function computeReward(input: RewardInput): Reward {
  const breakdown: { label: string; value: string }[] = [];

  if (!input.isCorrect) {
    // Одно очко за попытку: работа над ошибкой — тоже учёба.
    return { points: 1, breakdown: [{ label: 'Очко за попытку', value: '+1' }], streakMultiplier: 1 };
  }

  const base = BASE_BY_LEVEL[input.level];
  const modeMultiplier = MODE_MULTIPLIER[input.mode];
  const multiplier = streakMultiplier(input.sessionStreak);
  const typoFactor = input.matchType === 'typo' ? 0.5 : 1;

  breakdown.push({ label: `Уровень ${input.level}`, value: `${base}` });
  if (modeMultiplier !== 1) {
    breakdown.push({ label: MODE_LABELS[input.mode], value: `×${modeMultiplier}` });
  }
  if (multiplier > 1) {
    breakdown.push({ label: `Серия ${input.sessionStreak}`, value: `×${multiplier.toFixed(2)}` });
  }
  if (typoFactor < 1) {
    breakdown.push({ label: 'Опечатка', value: '×0.5' });
  }

  let points = base * modeMultiplier * multiplier * typoFactor;

  if (input.isFirstCorrect) {
    points += base;
    breakdown.push({ label: 'Новое слово', value: `+${base}` });
  }

  const speedBonus = input.responseMs > 0 && input.responseMs < 3000 ? 4 : input.responseMs < 6000 ? 2 : 0;
  if (speedBonus > 0) {
    points += speedBonus;
    breakdown.push({ label: 'Скорость', value: `+${speedBonus}` });
  }

  if (input.hintsUsed > 0) {
    points *= HINT_REWARD_FACTOR ** input.hintsUsed;
    breakdown.push({
      label: `Подсказки (${input.hintsUsed})`,
      value: `−${Math.round((1 - HINT_REWARD_FACTOR ** input.hintsUsed) * 100)}%`,
    });
  }

  return { points: Math.max(1, Math.round(points)), breakdown, streakMultiplier: multiplier };
}

/**
 * Платная подсказка в «Выборе варианта»: убирает два неверных из трёх.
 * Минимум 20 — это 3–4 верных ответа в этом режиме на A1, уже жалко, но
 * доступно с первых занятий. Дальше цена = 12% ширины текущего уровня
 * (кратно 5), чтобы на высоких уровнях подсказка не стала мелочью.
 */
export const CHOICE_HINT_COST_MIN = 20;
export const CHOICE_HINT_COST_SHARE = 0.12;

export function choiceHintCost(points: number): number {
  const progress = levelProgress(points);
  if (progress.isMax) return 250;
  const scaled = Math.round(progress.pointsForLevel * CHOICE_HINT_COST_SHARE);
  return Math.max(CHOICE_HINT_COST_MIN, Math.round(scaled / 5) * 5);
}

// ──────────────────────────────── Уровни ────────────────────────────────

export const MAX_LEVEL = 1000;

/**
 * Кривая уровней: всего очков для уровня L = BASE × L^EXPONENT.
 *
 * BASE = 50 совпадает со стартовым рейтингом новичка — первый уровень открыт
 * сразу. Показатель 2 — единственная степень, при которой второй уровень
 * приходит ровно на 200 очках (50 × 2² = 200). Квадрат делает рост
 * сверхлинейным: шаг между уровнями растёт с 150 очков в начале до ~100 000
 * на тысячном, а весь путь до 1000 стоит 50 000 000 очков.
 * Числа проверяются скриптом scripts/rating-curve.mjs.
 */
const LEVEL_BASE = 50;
const LEVEL_EXPONENT = 2;

/** Сколько очков всего нужно, чтобы достичь уровня. */
export function totalPointsForLevel(level: number): number {
  const clamped = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return Math.round(LEVEL_BASE * clamped ** LEVEL_EXPONENT);
}

/**
 * Уровень по очкам. Обратная функция даёт готовый ответ сразу, а короткая
 * доводка страхует от погрешности с плавающей точкой — перебора 1000 уровней нет.
 */
export function levelFromPoints(points: number): number {
  if (points < LEVEL_BASE) return 1;
  const guess = Math.floor((points / LEVEL_BASE) ** (1 / LEVEL_EXPONENT));
  let level = Math.min(Math.max(guess, 1), MAX_LEVEL);
  while (level < MAX_LEVEL && totalPointsForLevel(level + 1) <= points) level++;
  while (level > 1 && totalPointsForLevel(level) > points) level--;
  return level;
}

export interface LevelProgress {
  level: number;
  points: number;
  /** Очки, набранные внутри текущего уровня. */
  pointsIntoLevel: number;
  /** Сколько очков стоит текущий уровень целиком. */
  pointsForLevel: number;
  progress: number;
  /** Сколько очков осталось до следующего уровня. */
  pointsToNext: number;
  /** Порог следующего уровня; на максимуме — null. */
  nextLevelAt: number | null;
  isMax: boolean;
}

export function levelProgress(points: number): LevelProgress {
  const level = levelFromPoints(points);
  const start = totalPointsForLevel(level);

  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      points,
      pointsIntoLevel: 0,
      pointsForLevel: 0,
      progress: 1,
      pointsToNext: 0,
      nextLevelAt: null,
      isMax: true,
    };
  }

  const next = totalPointsForLevel(level + 1);
  const span = next - start;
  const into = Math.max(0, points - start);

  return {
    level,
    points,
    pointsIntoLevel: into,
    pointsForLevel: span,
    progress: span > 0 ? Math.min(into / span, 1) : 0,
    pointsToNext: Math.max(0, next - points),
    nextLevelAt: next,
    isMax: false,
  };
}

// ──────────────────────────── Бонусы и серии ────────────────────────────

/** Награда за завершение пулла: зависит от размера и точности. */
export function poolCompletionReward(size: number, correct: number, total: number) {
  const accuracy = total > 0 ? correct / total : 0;
  const points = size * 2 + Math.round(size * accuracy * 3);
  return { points, accuracy };
}

/** Бонус за дневную серию: растёт, но упирается в потолок. */
export function dailyStreakReward(streak: number): number {
  return Math.min(25 + streak * 10, 250);
}

export const DAILY_GOAL_REWARD = 150;
export const MASTERY_REWARD = 100;
/** Награда за один ход диалога с репетитором. */
export const CHAT_TURN_REWARD = 10;

// ──────────────────────────── Награды за уровни ────────────────────────────

/** Сколько заморозок серии можно держать одновременно. */
export const MAX_STREAK_FREEZES = 5;

/** Каждые столько уровней выдаётся заморозка серии. */
export const FREEZE_GRANT_EVERY = 5;

export type LevelRewardKind = 'mode' | 'theme' | 'freeze';

export interface LevelReward {
  code: string;
  title: string;
  description: string;
  level: number;
  kind: LevelRewardKind;
}

/**
 * Оформления открываются уровнем, а не покупкой. Те же пороги продублированы
 * во frontend/src/store/ui.ts — там они нужны, чтобы не ждать ответа сервера.
 */
export const THEME_UNLOCK_LEVEL: Record<string, number> = {
  theme_paper: 5,
  theme_night: 12,
};

const THEME_REWARDS: LevelReward[] = [
  {
    code: 'theme_paper',
    title: 'Оформление «Бумага»',
    description: 'Тёплая бумажная палитра вместо чисто белой.',
    level: THEME_UNLOCK_LEVEL['theme_paper']!,
    kind: 'theme',
  },
  {
    code: 'theme_night',
    title: 'Оформление «Ночь»',
    description: 'Тёмная тема для занятий вечером.',
    level: THEME_UNLOCK_LEVEL['theme_night']!,
    kind: 'theme',
  },
];

const FREEZE_REWARD: LevelReward = {
  code: 'freeze',
  title: 'Заморозка серии',
  description: `Выдаётся каждые ${FREEZE_GRANT_EVERY} уровней и хранится до ${MAX_STREAK_FREEZES} штук. Сохраняет дневную серию, если день пропущен.`,
  level: FREEZE_GRANT_EVERY,
  kind: 'freeze',
};

/** Полный список того, что открывает рост уровня — для экрана наград. */
export function levelRewards(): LevelReward[] {
  const modes: LevelReward[] = (Object.keys(MODE_UNLOCK_LEVEL) as PracticeMode[])
    .filter((mode) => MODE_UNLOCK_LEVEL[mode] > 1)
    .map((mode) => ({
      code: `mode_${mode}`,
      title: `Режим «${MODE_LABELS[mode]}»`,
      description: 'Новый формат тренировки в разделе «Слова».',
      level: MODE_UNLOCK_LEVEL[mode],
      kind: 'mode' as const,
    }));

  return [...modes, ...THEME_REWARDS, FREEZE_REWARD].sort((a, b) => a.level - b.level);
}
