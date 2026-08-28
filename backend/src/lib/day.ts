/**
 * Работа с «учебными днями». День считается в часовом поясе пользователя,
 * иначе серия обрывалась бы у полуночи по UTC.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ключ дня в формате YYYY-MM-DD с учётом смещения пояса (в минутах от UTC). */
export function dayKey(date: Date, timezoneOffsetMinutes: number): string {
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function todayKey(timezoneOffsetMinutes: number): string {
  return dayKey(new Date(), timezoneOffsetMinutes);
}

/** Разница в днях между двумя ключами (b - a). */
export function daysBetween(a: string, b: string): number {
  const parse = (key: string) => Date.parse(`${key}T00:00:00.000Z`);
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}

/** Ключ дня, отстоящий от заданного на `delta` дней. */
export function shiftDay(key: string, delta: number): string {
  const date = new Date(Date.parse(`${key}T00:00:00.000Z`) + delta * DAY_MS);
  return date.toISOString().slice(0, 10);
}

/** Список ключей дней за последние `count` дней, включая сегодняшний. */
export function lastDays(count: number, timezoneOffsetMinutes: number): string[] {
  const today = todayKey(timezoneOffsetMinutes);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(shiftDay(today, -i));
  return keys;
}
