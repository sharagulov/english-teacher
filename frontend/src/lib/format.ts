const numberFormat = new Intl.NumberFormat('ru-RU');

export const formatNumber = (value: number): string => numberFormat.format(Math.round(value));

export const formatPercent = (value: number | null | undefined, digits = 0): string =>
  value == null ? '—' : `${(value * 100).toFixed(digits)}%`;

/** Длительность в человекочитаемом виде: 45 с, 12 мин, 2 ч 15 мин. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '0 с';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} ч ${restMinutes} мин` : `${hours} ч`;
}

/** Время ответа: 1,4 с или 840 мс. */
export function formatResponseTime(ms: number): string {
  if (ms <= 0) return '—';
  return ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`;
}

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «12 марта» или «12 марта 2025», если год не текущий. */
export function formatDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const now = new Date();
  const base = `${date.getDate()} ${RU_MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

export function formatDateTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(date)}, ${time}`;
}

/** Ключ дня YYYY-MM-DD → «12 мар». */
export function formatDayKey(day: string): string {
  const [, month, date] = day.split('-');
  const shortMonths = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${Number(date)} ${shortMonths[Number(month) - 1] ?? ''}`;
}

/** Относительное время: «через 3 дня», «2 часа назад». */
export function formatRelative(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const diffMs = date.getTime() - Date.now();
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);

  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return future ? `через ${minutes} мин` : `${minutes} мин назад`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `через ${hours} ч` : `${hours} ч назад`;

  const days = Math.round(hours / 24);
  if (days < 30) return future ? `через ${plural(days, 'день', 'дня', 'дней')}` : `${plural(days, 'день', 'дня', 'дней')} назад`;

  const months = Math.round(days / 30);
  return future ? `через ${plural(months, 'месяц', 'месяца', 'месяцев')}` : `${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;
}

/** Правильная форма существительного при числе. */
export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${count} ${many}`;
  if (last > 1 && last < 5) return `${count} ${few}`;
  if (last === 1) return `${count} ${one}`;
  return `${count} ${many}`;
}

export const WORD_STATUS_LABELS: Record<string, string> = {
  new: 'новое',
  learning: 'изучается',
  review: 'на повторении',
  mastered: 'освоено',
  leech: 'проблемное',
};

export const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: 'точно',
  alternative: 'другой вариант',
  typo: 'с опечаткой',
  wrong: 'неверно',
};

export const MODE_LABELS: Record<string, string> = {
  classic: 'Новые слова',
  reverse: 'С русского',
  choice: 'Выбор варианта',
  listening: 'На слух',
  sprint: 'Спринт',
  weak: 'Слабые слова',
  srs: 'Повторение',
  mixed: 'Микс',
};

export const PART_OF_SPEECH_LABELS: Record<string, string> = {
  noun: 'существительное',
  verb: 'глагол',
  adjective: 'прилагательное',
  adverb: 'наречие',
  phrase: 'выражение',
  preposition: 'предлог',
  conjunction: 'союз',
  pronoun: 'местоимение',
  numeral: 'числительное',
  determiner: 'определитель',
  interjection: 'междометие',
  auxiliary: 'вспомогательный глагол',
};

/** Расшифровка причин начисления монет для истории операций. */
export function transactionLabel(reason: string): string {
  if (reason.startsWith('achievement:')) return 'Достижение';
  if (reason.startsWith('purchase:')) return 'Покупка';
  if (reason.startsWith('hint:')) return 'Подсказка';
  if (reason.startsWith('ai:')) return 'Задание ИИ';
  return (
    {
      correct_answer: 'Верный ответ',
      attempt: 'Попытка',
      pool_complete: 'Завершение пулла',
      word_mastered: 'Слово освоено',
      daily_goal: 'Дневная цель',
      daily_streak: 'Дневная серия',
      signup_bonus: 'Бонус за регистрацию',
    }[reason] ?? reason
  );
}
