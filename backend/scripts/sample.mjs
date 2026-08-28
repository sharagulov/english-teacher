import Database from 'better-sqlite3';
const db = new Database('prisma/dev.db', { readonly: true });

console.log('===== ранее проблемные слова =====');
const probe = ['swallow', 'sink', 'balloon', 'flat', 'split', 'con', 'irresponsible', 'bribe', 'tar', 'dip', 'enjoy', 'special', 'shrink'];
for (const w of probe) {
  const r = db.prepare('SELECT text, translations, partOfSpeech, level, gloss FROM Word WHERE text = ?').get(w);
  if (!r) { console.log(`${w.padEnd(15)} — отсутствует`); continue; }
  console.log(`${r.text.padEnd(15)} ${String(r.partOfSpeech ?? '—').padEnd(11)} ${r.level}  ${JSON.parse(r.translations).join(', ')}`);
}

console.log('\n===== случайная выборка по уровням =====');
for (const level of ['A1', 'B1', 'C1']) {
  console.log(`\n--- ${level} ---`);
  for (const r of db.prepare(`SELECT text, translations, partOfSpeech FROM Word WHERE level=? AND isFunctionWord=0 ORDER BY RANDOM() LIMIT 10`).all(level)) {
    console.log(`${r.text.padEnd(18)} ${String(r.partOfSpeech ?? '—').padEnd(11)} ${JSON.parse(r.translations).join(', ')}`);
  }
}

console.log('\n===== остатки разметки / латиницы =====');
const junk = db.prepare(`SELECT text, translations FROM Word WHERE translations LIKE '%[[%' OR translations LIKE '%]]%'`).all();
console.log('с вики-разметкой:', junk.length);
for (const r of junk.slice(0, 5)) console.log('  ', r.text, r.translations);

const caps = db.prepare(`SELECT COUNT(*) c FROM Word WHERE partOfSpeech = 'proper noun'`).get();
console.log('имён собственных осталось:', caps.c);
