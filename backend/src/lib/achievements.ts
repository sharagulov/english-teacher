export interface AchievementDefinition {
    code: string;
    title: string;
    description: string;
    category: 'words' | 'accuracy' | 'streak' | 'ai' | 'rating';
    threshold: number;
    metric: AchievementMetric;
    points: number;
}
export type AchievementMetric = 'wordsLearned' | 'wordsMastered' | 'totalCorrect' | 'dailyStreak' | 'poolsCompleted' | 'bestSessionStreak' | 'aiTasksDone' | 'ratingLevel' | 'perfectPools';
export const ACHIEVEMENTS: AchievementDefinition[] = [
    { code: 'first_word', title: 'Первое слово', description: 'Верно перевести первое слово.', category: 'words', metric: 'totalCorrect', threshold: 1, points: 30 },
    { code: 'correct_100', title: 'Сотня', description: '100 верных ответов.', category: 'words', metric: 'totalCorrect', threshold: 100, points: 210 },
    { code: 'correct_500', title: 'Полтысячи', description: '500 верных ответов.', category: 'words', metric: 'totalCorrect', threshold: 500, points: 700 },
    { code: 'correct_2000', title: 'Две тысячи', description: '2000 верных ответов.', category: 'words', metric: 'totalCorrect', threshold: 2000, points: 2200 },
    { code: 'learned_50', title: 'Словарь на 50', description: '50 слов переведены в режим повторения.', category: 'words', metric: 'wordsLearned', threshold: 50, points: 280 },
    { code: 'learned_250', title: 'Словарь на 250', description: '250 изученных слов.', category: 'words', metric: 'wordsLearned', threshold: 250, points: 850 },
    { code: 'learned_1000', title: 'Словарь на 1000', description: '1000 изученных слов — это уверенный B2.', category: 'words', metric: 'wordsLearned', threshold: 1000, points: 3500 },
    { code: 'mastered_25', title: 'Закреплено', description: '25 слов доведены до статуса «освоено».', category: 'words', metric: 'wordsMastered', threshold: 25, points: 420 },
    { code: 'mastered_200', title: 'Прочная база', description: '200 освоенных слов.', category: 'words', metric: 'wordsMastered', threshold: 200, points: 1700 },
    { code: 'streak_3', title: 'Три дня подряд', description: 'Заниматься три дня без пропусков.', category: 'streak', metric: 'dailyStreak', threshold: 3, points: 120 },
    { code: 'streak_7', title: 'Неделя', description: 'Семь дней подряд.', category: 'streak', metric: 'dailyStreak', threshold: 7, points: 350 },
    { code: 'streak_30', title: 'Месяц', description: 'Тридцать дней подряд.', category: 'streak', metric: 'dailyStreak', threshold: 30, points: 1700 },
    { code: 'streak_100', title: 'Сто дней', description: 'Сто дней подряд. Это уже привычка.', category: 'streak', metric: 'dailyStreak', threshold: 100, points: 7000 },
    { code: 'session_streak_20', title: 'Без промаха', description: '20 верных ответов подряд в одной сессии.', category: 'accuracy', metric: 'bestSessionStreak', threshold: 20, points: 300 },
    { code: 'session_streak_50', title: 'Снайпер', description: '50 верных ответов подряд.', category: 'accuracy', metric: 'bestSessionStreak', threshold: 50, points: 900 },
    { code: 'perfect_pool', title: 'Чистый пулл', description: 'Пройти пулл без единой ошибки.', category: 'accuracy', metric: 'perfectPools', threshold: 1, points: 170 },
    { code: 'perfect_pool_10', title: 'Десять чистых', description: 'Десять пуллов без ошибок.', category: 'accuracy', metric: 'perfectPools', threshold: 10, points: 1000 },
    { code: 'pools_10', title: 'Десять пуллов', description: 'Завершить 10 пуллов.', category: 'words', metric: 'poolsCompleted', threshold: 10, points: 260 },
    { code: 'pools_100', title: 'Сто пуллов', description: 'Завершить 100 пуллов.', category: 'words', metric: 'poolsCompleted', threshold: 100, points: 2000 },
    { code: 'ai_first', title: 'Знакомство с ИИ', description: 'Выполнить первое задание от ИИ.', category: 'ai', metric: 'aiTasksDone', threshold: 1, points: 70 },
    { code: 'ai_50', title: 'Практика речи', description: '50 выполненных заданий от ИИ.', category: 'ai', metric: 'aiTasksDone', threshold: 50, points: 850 },
    { code: 'level_10', title: 'Десятый уровень', description: 'Поднять рейтинг до 10 уровня.', category: 'rating', metric: 'ratingLevel', threshold: 10, points: 300 },
    { code: 'level_50', title: 'Пятидесятый уровень', description: 'Поднять рейтинг до 50 уровня — это уже месяцы работы.', category: 'rating', metric: 'ratingLevel', threshold: 50, points: 1500 },
    { code: 'level_100', title: 'Сотый уровень', description: 'Поднять рейтинг до 100 уровня.', category: 'rating', metric: 'ratingLevel', threshold: 100, points: 5000 },
    { code: 'level_250', title: 'Двести пятьдесят', description: 'Поднять рейтинг до 250 уровня. Такое даётся годами.', category: 'rating', metric: 'ratingLevel', threshold: 250, points: 20000 },
];
export const ACHIEVEMENTS_BY_CODE = new Map(ACHIEVEMENTS.map((a) => [a.code, a]));
export type AchievementMetrics = Record<AchievementMetric, number>;
export function evaluateAchievements(metrics: AchievementMetrics, unlocked: Set<string>): AchievementDefinition[] {
    return ACHIEVEMENTS.filter((a) => !unlocked.has(a.code) && metrics[a.metric] >= a.threshold);
}
