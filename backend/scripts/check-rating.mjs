/** Быстрая проверка рейтинга на реальном аккаунте: вход → пулл → ответ → сводки. */
const BASE = 'http://127.0.0.1:4000/api';
let token = '';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const auth = await call('POST', '/auth/login', { email: 'pavel@lexio.local', password: 'lexio-2026' });
token = auth.token;
console.log('вход:', auth.user.name, '| очки', auth.user.points, '| уровень', auth.user.level, '| прогресс', auth.user.progress);

const overview = await call('GET', '/practice/overview');
console.log('подсказки:', overview.hints);
console.log('режимы открыты:', overview.modes.filter((m) => m.unlocked).map((m) => m.mode).join(', '));

let state = await call('POST', '/practice/pools', { mode: 'classic', size: 5 });
console.log('пулл:', state.pool.id, '| очков в пулле', state.pool.pointsEarned);

const hint = await call('POST', `/practice/pools/${state.pool.id}/hint`, {
  wordId: state.question.wordId,
  kind: 'letter',
});
console.log('подсказка:', hint);

const detail = await call('GET', `/words/${state.question.wordId}`);
const answer = await call('POST', `/practice/pools/${state.pool.id}/answer`, {
  wordId: state.question.wordId,
  answer: detail.word.translations[0],
  responseMs: 2500,
  hintsUsed: 1,
});
console.log('ответ верный:', answer.result.isCorrect);
console.log('награда:', answer.result.reward);
console.log('рейтинг:', answer.result.rating);

const stats = await call('GET', '/stats/overview');
console.log('сводка рейтинга:', stats.rating);
console.log('сегодня:', stats.today);

const rewards = await call('GET', '/rewards');
console.log('награды:', rewards.items.map((i) => `${i.level}:${i.code}${i.unlocked ? '✓' : ''}`).join(' '));
console.log('заморозки:', rewards.streakFreezes, 'из', rewards.maxStreakFreezes);

const achievements = await call('GET', '/stats/achievements');
console.log('достижений:', achievements.items.length, '| открыто:', achievements.items.filter((a) => a.unlockedAt).length);
console.log('пример:', achievements.items[0]);

const transactions = await call('GET', '/stats/transactions?limit=10');
console.log('история:', transactions.items.map((t) => `${t.reason} +${t.amount} → ${t.balanceAfter}`).join(' | '));

const pools = await call('GET', '/stats/pools?limit=3');
console.log('пуллы:', pools.items.map((p) => `${p.mode} +${p.pointsEarned}`).join(' | '));

const daily = await call('GET', '/stats/daily?days=7');
console.log('дни:', daily.series.slice(-3).map((d) => `${d.day}: ${d.points} очков`).join(' | '));

await call('POST', `/practice/pools/${state.pool.id}/abandon`);
console.log('\nготово');
