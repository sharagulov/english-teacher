const numberFormat = new Intl.NumberFormat('ru-RU');
export const formatNumber = (value: number): string => numberFormat.format(Math.round(value));
const usdFormat = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
});
const rubFormat = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
});
export function formatUsd(value: number): string {
    if (value > 0 && value < 0.005)
        return '< $0.01';
    return usdFormat.format(value);
}
export function formatRub(value: number): string {
    if (value > 0 && value < 0.5)
        return '< 1 ₽';
    return rubFormat.format(value);
}
export const formatPercent = (value: number | null | undefined, digits = 0): string => value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
export function formatDuration(ms: number): string {
    if (ms < 1000)
        return '0 с';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60)
        return `${seconds} с`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return restMinutes > 0 ? `${hours} ч ${restMinutes} мин` : `${hours} ч`;
}
export function formatResponseTime(ms: number): string {
    if (ms <= 0)
        return '—';
    return ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`;
}
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
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
export function formatDayKey(day: string): string {
    const [, month, date] = day.split('-');
    const shortMonths = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${Number(date)} ${shortMonths[Number(month) - 1] ?? ''}`;
}
export function formatRelative(input: string | Date): string {
    const date = typeof input === 'string' ? new Date(input) : input;
    const diffMs = date.getTime() - Date.now();
    const future = diffMs > 0;
    const abs = Math.abs(diffMs);
    const minutes = Math.round(abs / 60000);
    if (minutes < 1)
        return 'только что';
    if (minutes < 60)
        return future ? `через ${minutes} мин` : `${minutes} мин назад`;
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return future ? `через ${hours} ч` : `${hours} ч назад`;
    const days = Math.round(hours / 24);
    if (days < 30)
        return future ? `через ${plural(days, 'день', 'дня', 'дней')}` : `${plural(days, 'день', 'дня', 'дней')} назад`;
    const months = Math.round(days / 30);
    return future ? `через ${plural(months, 'месяц', 'месяца', 'месяцев')}` : `${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;
}
export function plural(count: number, one: string, few: string, many: string): string {
    const abs = Math.abs(count) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20)
        return `${count} ${many}`;
    if (last > 1 && last < 5)
        return `${count} ${few}`;
    if (last === 1)
        return `${count} ${one}`;
    return `${count} ${many}`;
}
export function splitAroundWord(sentence: string, word: string): {
    text: string;
    match: boolean;
}[] {
    const base = word.trim().toLowerCase();
    if (!/^[a-z][a-z' -]*$/.test(base))
        return [{ text: sentence, match: false }];
    const stem = base.length >= 4 ? base.replace(/[ey]$/, '') : base;
    const tail = stem.length >= 3 ? '[a-z]{0,4}' : '(?:s|es|d|ed|ing)?';
    const pattern = new RegExp(`\\b${escapeRegExp(stem)}${tail}\\b`, 'gi');
    const parts: {
        text: string;
        match: boolean;
    }[] = [];
    let cursor = 0;
    for (const found of sentence.matchAll(pattern)) {
        const start = found.index;
        if (start > cursor)
            parts.push({ text: sentence.slice(cursor, start), match: false });
        parts.push({ text: found[0], match: true });
        cursor = start + found[0].length;
    }
    if (cursor < sentence.length)
        parts.push({ text: sentence.slice(cursor), match: false });
    return parts.length > 0 ? parts : [{ text: sentence, match: false }];
}
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
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
    skipped: 'не знаю',
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
export function pointsWord(count: number): string {
    const abs = Math.abs(Math.round(count)) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20)
        return 'очков';
    if (last > 1 && last < 5)
        return 'очка';
    if (last === 1)
        return 'очко';
    return 'очков';
}
export const formatPoints = (value: number): string => `${formatNumber(value)} ${pointsWord(value)}`;
export function transactionLabel(reason: string): string {
    if (reason.startsWith('achievement:'))
        return 'Достижение';
    if (reason.startsWith('ai:'))
        return 'Задание ИИ';
    return ({
        correct_answer: 'Верный ответ',
        attempt: 'Попытка',
        pool_complete: 'Завершение пулла',
        word_mastered: 'Слово освоено',
        daily_goal: 'Дневная цель',
        daily_streak: 'Дневная серия',
        signup_bonus: 'Бонус за регистрацию',
    }[reason] ?? reason);
}
