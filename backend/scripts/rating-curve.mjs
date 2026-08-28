/**
 * Проверка кривой уровней: сколько очков и сколько занятий нужно на ключевые уровни.
 * Запуск: node scripts/rating-curve.mjs
 *
 * Числа здесь должны совпадать с backend/src/lib/economy.ts — скрипт нужен, чтобы
 * менять кривую осознанно, а не на глаз.
 */
const BASE = 50;
const EXPONENT = 2;
const MAX_LEVEL = 1000;

const totalForLevel = (level) => Math.round(BASE * Math.min(Math.max(level, 1), MAX_LEVEL) ** EXPONENT);

const levelFromPoints = (points) => {
  if (points < BASE) return 1;
  const guess = Math.floor((points / BASE) ** (1 / EXPONENT));
  let level = Math.min(Math.max(guess, 1), MAX_LEVEL);
  while (level < MAX_LEVEL && totalForLevel(level + 1) <= points) level++;
  while (level > 1 && totalForLevel(level) > points) level--;
  return level;
};

// Средний доход: ~14 очков за верный ответ плюс бонусы пулла, цели и серии.
const POINTS_PER_ANSWER = 14;
const ANSWERS_PER_HOUR = 220;
const POINTS_PER_DAY = 1600; // ~35 минут занятий в день

const rows = [1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 750, 1000];

console.log('уровень | всего очков | очков за уровень | ответов | часов | дней по 1600 очков');
for (const level of rows) {
  const total = totalForLevel(level);
  const step = level < MAX_LEVEL ? totalForLevel(level + 1) - total : 0;
  const answers = Math.round(total / POINTS_PER_ANSWER);
  const hours = answers / ANSWERS_PER_HOUR;
  const days = total / POINTS_PER_DAY;
  console.log(
    `${String(level).padStart(7)} | ${String(total).padStart(11)} | ${String(step).padStart(16)} | ` +
      `${String(answers).padStart(7)} | ${hours.toFixed(1).padStart(5)} | ${days.toFixed(1).padStart(6)}`,
  );
}

// Обратная функция должна попадать в уровень ровно на границе и на очко до неё.
let ok = true;
for (let level = 1; level <= MAX_LEVEL; level++) {
  const total = totalForLevel(level);
  if (levelFromPoints(total) !== level) {
    console.error(`граница уровня ${level}: ${levelFromPoints(total)} вместо ${level}`);
    ok = false;
  }
  if (level > 1 && levelFromPoints(total - 1) !== level - 1) {
    console.error(`очко до уровня ${level}: ${levelFromPoints(total - 1)} вместо ${level - 1}`);
    ok = false;
  }
}
console.log(ok ? '\nобратная функция согласована на всех 1000 уровнях' : '\nесть расхождения');
