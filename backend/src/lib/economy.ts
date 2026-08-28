/**
 * Экономика приложения: монеты, опыт, уровни, серии.
 *
 * Принципы:
 *  • За ошибку монеты не отнимаются — наказание только в потере множителя серии,
 *    иначе заниматься становится страшно.
 *  • Награда растёт за сложность (уровень слова, режим) и за скорость,
 *    но подсказки её уменьшают.
 *  • Первый верный ответ на новое слово даёт удвоенную награду — это делает
 *    расширение словаря выгоднее, чем перебор уже знакомых слов.
 */
import type { MatchType } from './text.js';
import type { CefrLevel } from './levels.js';

export type PracticeMode = 'classic' | 'reverse' | 'choice' | 'listening' | 'sprint' | 'weak' | 'srs' | 'mixed';

export const PRACTICE_MODES: PracticeMode[] = ['classic', 'reverse', 'choice', 'listening', 'sprint', 'weak', 'srs', 'mixed'];

/** Базовая награда за слово в зависимости от его уровня. */
const BASE_BY_LEVEL: Record<CefrLevel, number> = {
  A1: 4,
  A2: 5,
  B1: 7,
  B2: 9,
  C1: 12,
  C2: 15,
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
  coins: number;
  xp: number;
  /** Разбор начисления — показывается в интерфейсе, чтобы правила были прозрачны. */
  breakdown: { label: string; value: string }[];
  streakMultiplier: number;
}

/** Множитель за серию: каждые 3 верных ответа +15%, максимум ×2. */
export function streakMultiplier(sessionStreak: number): number {
  return 1 + Math.min(Math.floor(sessionStreak / 3) * 0.15, 1);
}

export function computeReward(input: RewardInput): Reward {
  const breakdown: { label: string; value: string }[] = [];

  if (!input.isCorrect) {
    // Небольшой опыт за попытку: работа над ошибкой — тоже учёба.
    return { coins: 0, xp: 1, breakdown: [{ label: 'Опыт за попытку', value: '+1 XP' }], streakMultiplier: 1 };
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

  let coins = base * modeMultiplier * multiplier * typoFactor;

  if (input.isFirstCorrect) {
    coins += base;
    breakdown.push({ label: 'Новое слово', value: `+${base}` });
  }

  const speedBonus = input.responseMs > 0 && input.responseMs < 3000 ? 2 : input.responseMs < 6000 ? 1 : 0;
  if (speedBonus > 0) {
    coins += speedBonus;
    breakdown.push({ label: 'Скорость', value: `+${speedBonus}` });
  }

  if (input.hintsUsed > 0) {
    coins /= 1 + input.hintsUsed;
    breakdown.push({ label: `Подсказки (${input.hintsUsed})`, value: `÷${1 + input.hintsUsed}` });
  }

  const finalCoins = Math.max(1, Math.round(coins));
  const xp = Math.max(1, Math.round(base * 1.5 * modeMultiplier * typoFactor));

  return { coins: finalCoins, xp, breakdown, streakMultiplier: multiplier };
}

// ──────────────────────────────── Уровни ────────────────────────────────

/** Сколько опыта нужно, чтобы перейти с уровня `level` на следующий. */
export function xpForNextLevel(level: number): number {
  return 200 + (level - 1) * 100;
}

/** Суммарный опыт, необходимый для достижения уровня. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpForNextLevel(n);
  return total;
}

export interface LevelProgress {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForLevel: number;
  progress: number;
}

export function levelProgress(xp: number): LevelProgress {
  let level = 1;
  let consumed = 0;
  while (consumed + xpForNextLevel(level) <= xp) {
    consumed += xpForNextLevel(level);
    level++;
  }
  const xpForLevel = xpForNextLevel(level);
  const xpIntoLevel = xp - consumed;
  return { level, xp, xpIntoLevel, xpForLevel, progress: xpIntoLevel / xpForLevel };
}

// ──────────────────────────── Бонусы и серии ────────────────────────────

/** Награда за завершение пулла: зависит от размера и точности. */
export function poolCompletionReward(size: number, correct: number, total: number) {
  const accuracy = total > 0 ? correct / total : 0;
  const coins = size + Math.round(size * accuracy * 2);
  const xp = size * 3;
  return { coins, xp, accuracy };
}

/** Бонус за дневную серию: растёт, но упирается в потолок. */
export function dailyStreakReward(streak: number): number {
  return Math.min(10 + streak * 5, 100);
}

export const DAILY_GOAL_REWARD = { coins: 50, xp: 100 };
export const MASTERY_REWARD = { coins: 40, xp: 80 };

// ──────────────────────────────── Магазин ────────────────────────────────

export type HintKind = 'letter' | 'gloss' | 'length' | 'choices';

/** Подсказки покупаются в момент использования и уменьшают награду за ответ. */
export const HINT_COSTS: Record<HintKind, number> = {
  length: 3,
  gloss: 8,
  letter: 12,
  choices: 20,
};

export const HINT_LABELS: Record<HintKind, string> = {
  length: 'Длина слова',
  gloss: 'Пояснение по-английски',
  letter: 'Первая буква',
  choices: 'Четыре варианта',
};

export interface ShopItem {
  code: string;
  title: string;
  description: string;
  price: number;
  /** Расходуемые предметы складываются в инвентарь, остальные покупаются один раз. */
  consumable: boolean;
  maxQuantity?: number;
  requiresLevel?: number;
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    code: 'skip',
    title: 'Пропуск слова',
    description: 'Убрать слово из текущего пулла, не теряя серию верных ответов.',
    price: 35,
    consumable: true,
    maxQuantity: 20,
  },
  {
    code: 'freeze',
    title: 'Заморозка серии',
    description: 'Сохраняет дневную серию, если вы пропустили день занятий.',
    price: 150,
    consumable: true,
    maxQuantity: 5,
  },
  {
    code: 'double_xp',
    title: 'Двойной опыт — 30 минут',
    description: 'Весь опыт за ответы удваивается в течение получаса после активации.',
    price: 250,
    consumable: true,
    maxQuantity: 10,
  },
  {
    code: 'theme_paper',
    title: 'Оформление «Бумага»',
    description: 'Тёплая бумажная палитра вместо чисто белой.',
    price: 400,
    consumable: false,
    requiresLevel: 3,
  },
  {
    code: 'theme_night',
    title: 'Оформление «Ночь»',
    description: 'Тёмная тема для занятий вечером.',
    price: 400,
    consumable: false,
    requiresLevel: 3,
  },
];

export function findShopItem(code: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.code === code);
}
