/**
 * Достижения. Определения живут в коде, а в БД хранится только факт получения —
 * так набор можно расширять без миграций.
 */

export interface AchievementDefinition {
  code: string;
  title: string;
  description: string;
  category: 'words' | 'accuracy' | 'streak' | 'ai' | 'economy';
  /** Порог, при достижении которого награда выдаётся. */
  threshold: number;
  /** Какой показатель сравнивается с порогом. */
  metric: AchievementMetric;
  coins: number;
  xp: number;
}

export type AchievementMetric =
  | 'wordsLearned'
  | 'wordsMastered'
  | 'totalCorrect'
  | 'dailyStreak'
  | 'poolsCompleted'
  | 'bestSessionStreak'
  | 'aiTasksDone'
  | 'coinsEarned'
  | 'perfectPools';

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { code: 'first_word', title: 'Первое слово', description: 'Верно перевести первое слово.', category: 'words', metric: 'totalCorrect', threshold: 1, coins: 10, xp: 20 },
  { code: 'correct_100', title: 'Сотня', description: '100 верных ответов.', category: 'words', metric: 'totalCorrect', threshold: 100, coins: 60, xp: 150 },
  { code: 'correct_500', title: 'Полтысячи', description: '500 верных ответов.', category: 'words', metric: 'totalCorrect', threshold: 500, coins: 200, xp: 500 },
  { code: 'correct_2000', title: 'Две тысячи', description: '2000 верных ответов.', category: 'words', metric: 'totalCorrect', threshold: 2000, coins: 700, xp: 1500 },

  { code: 'learned_50', title: 'Словарь на 50', description: '50 слов переведены в режим повторения.', category: 'words', metric: 'wordsLearned', threshold: 50, coins: 80, xp: 200 },
  { code: 'learned_250', title: 'Словарь на 250', description: '250 изученных слов.', category: 'words', metric: 'wordsLearned', threshold: 250, coins: 250, xp: 600 },
  { code: 'learned_1000', title: 'Словарь на 1000', description: '1000 изученных слов — это уверенный B2.', category: 'words', metric: 'wordsLearned', threshold: 1000, coins: 1000, xp: 2500 },

  { code: 'mastered_25', title: 'Закреплено', description: '25 слов доведены до статуса «освоено».', category: 'words', metric: 'wordsMastered', threshold: 25, coins: 120, xp: 300 },
  { code: 'mastered_200', title: 'Прочная база', description: '200 освоенных слов.', category: 'words', metric: 'wordsMastered', threshold: 200, coins: 500, xp: 1200 },

  { code: 'streak_3', title: 'Три дня подряд', description: 'Заниматься три дня без пропусков.', category: 'streak', metric: 'dailyStreak', threshold: 3, coins: 40, xp: 80 },
  { code: 'streak_7', title: 'Неделя', description: 'Семь дней подряд.', category: 'streak', metric: 'dailyStreak', threshold: 7, coins: 100, xp: 250 },
  { code: 'streak_30', title: 'Месяц', description: 'Тридцать дней подряд.', category: 'streak', metric: 'dailyStreak', threshold: 30, coins: 500, xp: 1200 },
  { code: 'streak_100', title: 'Сто дней', description: 'Сто дней подряд. Это уже привычка.', category: 'streak', metric: 'dailyStreak', threshold: 100, coins: 2000, xp: 5000 },

  { code: 'session_streak_20', title: 'Без промаха', description: '20 верных ответов подряд в одной сессии.', category: 'accuracy', metric: 'bestSessionStreak', threshold: 20, coins: 100, xp: 200 },
  { code: 'session_streak_50', title: 'Снайпер', description: '50 верных ответов подряд.', category: 'accuracy', metric: 'bestSessionStreak', threshold: 50, coins: 300, xp: 600 },
  { code: 'perfect_pool', title: 'Чистый пулл', description: 'Пройти пулл без единой ошибки.', category: 'accuracy', metric: 'perfectPools', threshold: 1, coins: 50, xp: 120 },
  { code: 'perfect_pool_10', title: 'Десять чистых', description: 'Десять пуллов без ошибок.', category: 'accuracy', metric: 'perfectPools', threshold: 10, coins: 300, xp: 700 },

  { code: 'pools_10', title: 'Десять пуллов', description: 'Завершить 10 пуллов.', category: 'words', metric: 'poolsCompleted', threshold: 10, coins: 80, xp: 180 },
  { code: 'pools_100', title: 'Сто пуллов', description: 'Завершить 100 пуллов.', category: 'words', metric: 'poolsCompleted', threshold: 100, coins: 600, xp: 1400 },

  { code: 'ai_first', title: 'Знакомство с ИИ', description: 'Выполнить первое задание от ИИ.', category: 'ai', metric: 'aiTasksDone', threshold: 1, coins: 20, xp: 50 },
  { code: 'ai_50', title: 'Практика речи', description: '50 выполненных заданий от ИИ.', category: 'ai', metric: 'aiTasksDone', threshold: 50, coins: 250, xp: 600 },

  { code: 'coins_1000', title: 'Первая тысяча', description: 'Заработать 1000 монет.', category: 'economy', metric: 'coinsEarned', threshold: 1000, coins: 100, xp: 200 },
  { code: 'coins_10000', title: 'Капитал', description: 'Заработать 10 000 монет.', category: 'economy', metric: 'coinsEarned', threshold: 10_000, coins: 800, xp: 1500 },
];

export const ACHIEVEMENTS_BY_CODE = new Map(ACHIEVEMENTS.map((a) => [a.code, a]));

export type AchievementMetrics = Record<AchievementMetric, number>;

/** Возвращает достижения, которые пора выдать: порог достигнут, а записи ещё нет. */
export function evaluateAchievements(metrics: AchievementMetrics, unlocked: Set<string>): AchievementDefinition[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.code) && metrics[a.metric] >= a.threshold);
}
