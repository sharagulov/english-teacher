/** Сквозная проверка API: регистрация → пулл → ответы → статистика. */
const BASE = 'http://127.0.0.1:4000/api';
let token = '';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

const ok = (label, value) => console.log(`  ✓ ${label}${value === undefined ? '' : `: ${value}`}`);

console.log('\n1. Здоровье сервиса');
const health = await call('GET', '/health');
ok('слов в словаре', health.words);
ok('ИИ', health.aiEnabled ? 'включён' : 'выключен');

console.log('\n2. Регистрация');
const email = `test${Date.now()}@lexio.local`;
const auth = await call('POST', '/auth/register', {
  email,
  password: 'test-password-123',
  name: 'Тестовый ученик',
  cefrLevel: 'A2',
  timezoneOffset: 180,
});
token = auth.token;
ok('пользователь', `${auth.user.name}, очков ${auth.user.points}, уровень ${auth.user.level}`);
ok('прогресс уровня', `${auth.user.progress.pointsIntoLevel}/${auth.user.progress.pointsForLevel} до ${auth.user.progress.level + 1} уровня`);

console.log('\n3. Обзор режимов');
const overview = await call('GET', '/practice/overview');
ok('уровни', overview.levels.join(', '));
ok('новых слов доступно', overview.availability.newWords);
ok('открытых режимов', overview.modes.filter((m) => m.unlocked).map((m) => m.mode).join(', '));
ok('тем', overview.topics.length);

console.log('\n4. Создание пулла на 10 слов');
let state = await call('POST', '/practice/pools', { mode: 'classic', size: 10 });
const poolId = state.pool.id;
ok('пулл', `${poolId} (${state.pool.size} слов, №${state.pool.ordinal})`);
ok('первый вопрос', `${state.question.prompt} [${state.question.level}]`);

console.log('\n5. Намеренно неверный ответ');
const wrong = await call('POST', `/practice/pools/${poolId}/answer`, {
  wordId: state.question.wordId,
  answer: 'заведомо неверный ответ',
  responseMs: 4000,
  hintsUsed: 0,
});
ok('результат', wrong.result.isCorrect ? 'ВЕРНО (ошибка теста!)' : 'неверно, как и ожидалось');
ok('показан правильный перевод', wrong.result.correctAnswer);
ok('очков за ошибку', wrong.result.reward.points);
ok('слов осталось в пулле', wrong.state.progress.remaining);
const wrongWordId = state.question.wordId;

console.log('\n6. Проходим пулл до конца, отвечая верно');
state = wrong.state;
let answered = 0;
let seenAgain = false;
let lastResult = null;

while (state.question && answered < 60) {
  const wordId = state.question.wordId;
  if (wordId === wrongWordId && answered > 0) seenAgain = true;

  // Правильный ответ узнаём из карточки слова.
  const detail = await call('GET', `/words/${wordId}`);
  const answer = detail.word.translations[0];

  const res = await call('POST', `/practice/pools/${poolId}/answer`, {
    wordId,
    answer,
    responseMs: 2500,
    hintsUsed: 0,
  });
  if (!res.result.isCorrect) {
    console.log(`  ! не зачтён верный перевод «${answer}» для «${detail.word.text}» (ожидалось: ${res.result.allAnswers.join(', ')})`);
  }
  lastResult = res.result;
  state = res.state;
  answered++;
}

ok('ответов дано', answered);
ok('неотгаданное слово вернулось в пулл', seenAgain ? 'да' : 'НЕТ (проверить логику)');
ok('пулл завершён', state.pool.status);
if (lastResult?.poolSummary) {
  const s = lastResult.poolSummary;
  ok('итог пулла', `верно ${s.correct}, ошибок ${s.wrong}, точность ${(s.accuracy * 100).toFixed(0)}%, очков ${s.points}`);
}
if (lastResult?.rating) {
  ok('рейтинг', `${lastResult.rating.points} очков, уровень ${lastResult.rating.level}`);
}
if (lastResult?.achievements?.length) {
  ok('достижения', lastResult.achievements.map((a) => a.title).join(', '));
}

console.log('\n7. Подсказка в новом пулле');
state = await call('POST', '/practice/pools', { mode: 'classic', size: 5 });
const hint = await call('POST', `/practice/pools/${state.pool.id}/hint`, {
  wordId: state.question.wordId,
  kind: 'letter',
});
ok('подсказка «первая буква»', `«${hint.value}», награда за слово ниже на ${Math.round(hint.penalty * 100)}%`);

console.log('\n8. Статистика');
const stats = await call('GET', '/stats/overview');
ok('встречено слов', stats.words.encountered);
ok('точность', `${(stats.answers.accuracy * 100).toFixed(0)}%`);
ok('средняя скорость ответа', `${stats.answers.avgResponseMs} мс`);
ok('дневная цель', `${stats.today.correct}/${stats.today.goal}`);
ok('к повторению сейчас', stats.review.dueNow);
ok('рейтинг', `${stats.rating.points} очков, уровень ${stats.rating.level}, до следующего ${stats.rating.progress.pointsToNext}`);

const table = await call('GET', '/stats/words?sort=errors&order=desc&perPage=5');
ok('таблица слов', `${table.total} записей`);
for (const item of table.items.slice(0, 5)) {
  console.log(`      ${item.text.padEnd(16)} показов ${item.timesSeen}, ошибок ${item.timesWrong}, освоенность ${(item.strength * 100).toFixed(0)}%, статус ${item.status}`);
}

const breakdown = await call('GET', '/stats/breakdown');
ok('разрез по режимам', breakdown.byMode.map((m) => `${m.mode} ${(m.accuracy * 100).toFixed(0)}%`).join(', '));
ok('разрез по уровням', breakdown.byLevel.filter((l) => l.total > 0).map((l) => `${l.level}:${l.total}`).join(' '));

const daily = await call('GET', '/stats/daily?days=7');
ok('дней в серии данных', daily.series.length);

console.log('\n9. Награды за уровень');
const rewards = await call('GET', '/rewards');
ok('всего наград', rewards.items.length);
ok('открыто', rewards.items.filter((i) => i.unlocked).map((i) => i.code).join(', ') || 'ничего');
ok('заморозок серии', `${rewards.streakFreezes} из ${rewards.maxStreakFreezes}`);

console.log('\n10. Прочие режимы');
for (const mode of ['choice', 'reverse', 'srs', 'weak']) {
  try {
    const s = await call('POST', '/practice/pools', { mode, size: 5 });
    ok(`режим ${mode}`, `создан, вопрос: ${s.question?.prompt}${s.question?.choices ? ` | варианты: ${s.question.choices.join(' / ')}` : ''}`);
  } catch (e) {
    console.log(`  ○ режим ${mode}: ${String(e.message).split('\n')[0]}`);
  }
}

console.log('\n11. Словарь');
const dict = await call('GET', '/words?level=B1&perPage=5');
ok('всего B1', dict.total);
for (const w of dict.items) console.log(`      ${w.text} — ${w.translations.join(', ')}`);

console.log('\n12. ИИ (ожидаем корректную ошибку без ключа)');
try {
  await call('POST', '/ai/tasks', { type: 'grammar_quiz' });
  ok('задание создано', 'ключ настроен');
} catch (e) {
  ok('сообщение об отсутствии ключа', String(e.message).slice(0, 120));
}

console.log('\n✔ Проверка завершена\n');
