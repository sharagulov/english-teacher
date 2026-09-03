import type { MatchType } from './text.js';
import type { CefrLevel } from './levels.js';
export type PracticeMode = 'classic' | 'reverse' | 'choice' | 'listening' | 'sprint' | 'weak' | 'srs' | 'mixed';
/** Режимы в UI. `listening` временно скрыт — вернуть в массив, когда откроем доступ. */
export const PRACTICE_MODES = ['classic', 'weak', 'srs'] as const satisfies readonly PracticeMode[];
export type SelectablePracticeMode = (typeof PRACTICE_MODES)[number];
export type AnswerFormat = 'typed' | 'choice';
export const ANSWER_FORMAT_MULTIPLIER: Record<AnswerFormat, number> = {
    typed: 1,
    choice: 0.6,
};
export const ANSWER_FORMAT_LABELS: Record<AnswerFormat, string> = {
    typed: 'Ввод вручную',
    choice: 'Выбор варианта',
};
const BASE_BY_LEVEL: Record<CefrLevel, number> = {
    A1: 6,
    A2: 8,
    B1: 11,
    B2: 14,
    C1: 18,
    C2: 22,
};
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
export const MODE_UNLOCK_LEVEL: Record<SelectablePracticeMode, number> = {
    classic: 1,
    srs: 1,
    weak: 2,
};
export interface RewardInput {
    level: CefrLevel;
    mode: PracticeMode;
    answerFormat?: AnswerFormat;
    matchType: MatchType;
    isCorrect: boolean;
    sessionStreak: number;
    responseMs: number;
    hintsUsed: number;
    isFirstCorrect: boolean;
}
export interface Reward {
    points: number;
    breakdown: {
        label: string;
        value: string;
    }[];
    streakMultiplier: number;
}
export function streakMultiplier(sessionStreak: number): number {
    return 1 + Math.min(Math.floor(sessionStreak / 3) * 0.15, 1);
}
export const HINT_REWARD_FACTOR = 0.6;
export function computeReward(input: RewardInput): Reward {
    const breakdown: {
        label: string;
        value: string;
    }[] = [];
    if (!input.isCorrect) {
        return { points: 1, breakdown: [{ label: 'Очко за попытку', value: '+1' }], streakMultiplier: 1 };
    }
    const base = BASE_BY_LEVEL[input.level];
    const formatMultiplier = ANSWER_FORMAT_MULTIPLIER[input.answerFormat ?? 'typed'];
    const modeMultiplier = MODE_MULTIPLIER[input.mode] * formatMultiplier;
    const multiplier = streakMultiplier(input.sessionStreak);
    const typoFactor = input.matchType === 'typo' ? 0.5 : 1;
    breakdown.push({ label: `Уровень ${input.level}`, value: `${base}` });
    if (modeMultiplier !== 1) {
        const modePart = MODE_MULTIPLIER[input.mode] !== 1 ? MODE_LABELS[input.mode] : null;
        const formatPart = formatMultiplier !== 1 ? ANSWER_FORMAT_LABELS[input.answerFormat ?? 'choice'] : null;
        const label = [modePart, formatPart].filter(Boolean).join(', ') || MODE_LABELS[input.mode];
        breakdown.push({ label, value: `×${modeMultiplier.toFixed(2).replace(/\.?0+$/, '')}` });
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
export const CHOICE_HINT_COST_MIN = 20;
export const CHOICE_HINT_COST_SHARE = 0.12;
export function choiceHintCost(points: number): number {
    const progress = levelProgress(points);
    if (progress.isMax)
        return 250;
    const scaled = Math.round(progress.pointsForLevel * CHOICE_HINT_COST_SHARE);
    return Math.max(CHOICE_HINT_COST_MIN, Math.round(scaled / 5) * 5);
}
export const MAX_LEVEL = 1000;
const LEVEL_BASE = 50;
const LEVEL_EXPONENT = 2;
export function totalPointsForLevel(level: number): number {
    const clamped = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
    return Math.round(LEVEL_BASE * clamped ** LEVEL_EXPONENT);
}
export function levelFromPoints(points: number): number {
    if (points < LEVEL_BASE)
        return 1;
    const guess = Math.floor((points / LEVEL_BASE) ** (1 / LEVEL_EXPONENT));
    let level = Math.min(Math.max(guess, 1), MAX_LEVEL);
    while (level < MAX_LEVEL && totalPointsForLevel(level + 1) <= points)
        level++;
    while (level > 1 && totalPointsForLevel(level) > points)
        level--;
    return level;
}
export interface LevelProgress {
    level: number;
    points: number;
    pointsIntoLevel: number;
    pointsForLevel: number;
    progress: number;
    pointsToNext: number;
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
export function poolCompletionReward(size: number, correct: number, total: number) {
    const accuracy = total > 0 ? correct / total : 0;
    const points = size * 2 + Math.round(size * accuracy * 3);
    return { points, accuracy };
}
export function dailyStreakReward(streak: number): number {
    return Math.min(25 + streak * 10, 250);
}
export const DAILY_GOAL_REWARD = 150;
export const MASTERY_REWARD = 100;
export const CHAT_TURN_REWARD = 10;
export const MAX_STREAK_FREEZES = 5;
export const FREEZE_GRANT_EVERY = 5;
export type LevelRewardKind = 'mode' | 'theme' | 'freeze';
export interface LevelReward {
    code: string;
    title: string;
    description: string;
    level: number;
    kind: LevelRewardKind;
}
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
export function levelRewards(): LevelReward[] {
    const modes: LevelReward[] = (Object.keys(MODE_UNLOCK_LEVEL) as SelectablePracticeMode[])
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
