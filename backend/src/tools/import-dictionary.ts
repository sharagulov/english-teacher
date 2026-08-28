/**
 * Единоразовый импорт словаря из открытых источников в локальную БД.
 *
 *   npm run db:import -- [--limit 12000] [--refresh] [--min-score 40]
 *
 * Что объединяется:
 *   1. частотный список google-10000-english → frequencyRank и приоритет выдачи;
 *   2. CEFR-J Vocabulary Profile + Octanove C1/C2 → уровень A1…C2, часть речи, тема;
 *   3. WikDict en-ru (данные Викисловаря) → русские переводы, значения и пояснения.
 *
 * После импорта приложение не зависит от внешних сервисов: словарь целиком лежит
 * в собственной базе, а прогресс каждого пользователя ведётся отдельно.
 */
import Database from 'better-sqlite3';
import { prisma } from '../db.js';
import { parseCsvObjects } from '../lib/csv.js';
import { CEFR_LEVELS, isCefrLevel, isFunctionWord, levelFromFrequency, levelIndex, normalizePos, type CefrLevel } from '../lib/levels.js';
import { SOURCES, ensureSource, readTextSource } from '../lib/sources.js';
import { normalize, stripStress, stripWikiMarkup } from '../lib/text.js';

interface Options {
  limit: number;
  refresh: boolean;
  minScore: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { limit: 12_000, refresh: false, minScore: 40 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--refresh') options.refresh = true;
    else if (arg === '--limit') options.limit = Number(argv[++i]) || options.limit;
    else if (arg === '--min-score') options.minScore = Number(argv[++i]) ?? options.minScore;
  }
  return options;
}

const log = (message: string) => console.log(message);

// ─────────────────────────── источник: частотность ───────────────────────────

async function loadFrequency(refresh: boolean): Promise<Map<string, number>> {
  const text = await readTextSource('frequency', { refresh, onProgress: log });
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const line of text.split('\n')) {
    const word = line.trim().toLowerCase();
    if (!word) continue;
    rank++;
    if (!ranks.has(word)) ranks.set(word, rank);
  }
  log(`  → частотный список: ${ranks.size.toLocaleString('ru')} слов`);
  return ranks;
}

// ─────────────────────────── источник: уровни CEFR ───────────────────────────

interface CefrEntry {
  level: CefrLevel;
  pos: string | null;
  topic: string | null;
}

/**
 * Заголовки в CEFR-J бывают вида `a.m./A.M./am/AM` или `focus (on)` —
 * приводим к списку пригодных вариантов.
 */
function expandHeadword(raw: string): string[] {
  const cleaned = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .trim();

  return cleaned
    .split('/')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[a-z][a-z' -]*$/.test(part) && part.length >= 2);
}

/** Нормализует уровень CEFR-J (`A1.1`, `B2.2`) к базовому `A1`…`C2`. */
function baseLevel(raw: string): CefrLevel | null {
  const match = raw.trim().toUpperCase().match(/^([ABC][12])/);
  if (!match) return null;
  const level = match[1]!;
  return isCefrLevel(level) ? level : null;
}

async function loadCefrProfiles(refresh: boolean): Promise<Map<string, CefrEntry>> {
  const result = new Map<string, CefrEntry>();

  const consider = (headword: string, entry: CefrEntry) => {
    const existing = result.get(headword);
    if (!existing) {
      result.set(headword, entry);
      return;
    }
    // Оставляем самый низкий уровень (слово вводится раньше всего),
    // но не теряем тему и часть речи, если их не было.
    const takeNewLevel = levelIndex(entry.level) < levelIndex(existing.level);
    result.set(headword, {
      level: takeNewLevel ? entry.level : existing.level,
      pos: existing.pos ?? entry.pos,
      topic: existing.topic ?? entry.topic,
    });
  };

  const cefrj = parseCsvObjects(await readTextSource('cefrj', { refresh, onProgress: log }));
  for (const row of cefrj) {
    const level = baseLevel(row['CEFR'] ?? '');
    if (!level) continue;
    const topic = row['CoreInventory 1'] || row['CoreInventory 2'] || row['Threshold'] || null;
    const pos = normalizePos(row['pos']);
    for (const headword of expandHeadword(row['headword'] ?? '')) {
      consider(headword, { level, pos, topic: topic?.trim() || null });
    }
  }
  log(`  → CEFR-J: ${cefrj.length.toLocaleString('ru')} записей`);

  const octanove = parseCsvObjects(await readTextSource('octanove', { refresh, onProgress: log }));
  for (const row of octanove) {
    const level = baseLevel(row['CEFR'] ?? '');
    if (!level) continue;
    const pos = normalizePos(row['pos']);
    for (const headword of expandHeadword(row['headword'] ?? '')) {
      consider(headword, { level, pos, topic: null });
    }
  }
  log(`  → Octanove C1/C2: ${octanove.length.toLocaleString('ru')} записей`);
  log(`  → всего уникальных заголовков с уровнем: ${result.size.toLocaleString('ru')}`);

  return result;
}

// ─────────────────────────── источник: переводы ───────────────────────────

interface SenseGroup {
  sense: string;
  translations: string[];
}

/** Переводы, сгруппированные по части речи: у «swallow» разные значения как у глагола и существительного. */
interface PosBucket {
  pos: string | null;
  translations: string[];
  senses: SenseGroup[];
  score: number;
}

interface TranslationEntry {
  buckets: PosBucket[];
  score: number;
}

/**
 * Выбирает подходящую группу переводов: сначала совпадающую по части речи
 * (её знает профиль CEFR), иначе — самую весомую.
 */
function resolveBucket(entry: TranslationEntry, preferredPos: string | null): PosBucket {
  const best = entry.buckets[0]!;
  if (!preferredPos) return best;

  const matching = entry.buckets.find((b) => b.pos === preferredPos && b.translations.length > 0);
  if (!matching) return best;

  // Если по нужной части речи нашлось всего одно значение, добавляем варианты
  // из основной группы — иначе список допустимых ответов будет слишком узким.
  if (matching.translations.length === 1 && matching !== best) {
    const merged = [...matching.translations];
    for (const translation of best.translations) {
      if (merged.length >= 5) break;
      if (!merged.some((t) => normalize(t) === normalize(translation))) merged.push(translation);
    }
    return { ...matching, translations: merged };
  }

  return matching;
}

/** Чистит список русских переводов: снимает ударения и разметку, убирает мусор и дубли. */
function cleanTranslations(rawList: string, englishWord: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  // Разметку снимаем до разбиения: вики-ссылки вида `[[слово|форма]]`
  // сами содержат разделитель `|`.
  const pieces = stripWikiMarkup(stripStress(rawList)).split('|');

  for (const piece of pieces) {
    const value = piece.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    // Отбрасываем латиницу (непереведённые остатки) и слишком длинные описания.
    if (!/[а-яё]/i.test(value)) continue;
    if (/[a-z]{2,}/i.test(value)) continue;
    if (value.length > 48) continue;
    if (normalize(value) === normalize(englishWord)) continue;
    // Слово со строчной буквы не может переводиться топонимом или брендом.
    if (/^[А-ЯЁ]/.test(value) && /^[a-z]/.test(englishWord)) continue;

    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }

  return out;
}

function posFromLexentry(lexentry: string | null): string | null {
  if (!lexentry) return null;
  const match = lexentry.match(/__([A-Za-z_]+)__/);
  return normalizePos(match?.[1]?.replace(/_/g, ' ') ?? null);
}

/**
 * Похоже ли на имя собственное: все переводы начинаются с заглавной кириллической
 * буквы, хотя английское слово записано со строчной.
 */
function looksLikeProperNoun(translations: string[]): boolean {
  return translations.length > 0 && translations.every((t) => /^[А-ЯЁ]/.test(t));
}

async function loadTranslations(refresh: boolean): Promise<Map<string, TranslationEntry>> {
  const file = await ensureSource('translations', { refresh, onProgress: log });
  const db = new Database(file, { readonly: true });

  const entries = new Map<string, TranslationEntry>();

  /*
   * Основные переводы собираем из таблицы значений, отсортированной по весу:
   * `simple_translation` отдаёт варианты по алфавиту, из-за чего у «flat»
   * первым оказывались «балетки» вместо «плоский».
   */
  const senseRows = db
    .prepare<[], { written_rep: string; lexentry: string | null; sense: string | null; trans_list: string; score: number | null; importance: number | null }>(
      `SELECT written_rep, lexentry, sense, trans_list, score, importance
         FROM translation
        WHERE written_rep IS NOT NULL AND trans_list IS NOT NULL
        ORDER BY score DESC, importance DESC`,
    )
    .all();

  for (const row of senseRows) {
    const word = row.written_rep.trim().toLowerCase();
    if (!word) continue;

    const translations = cleanTranslations(row.trans_list, word, 4);
    if (translations.length === 0) continue;

    const score = row.score ?? 0;
    const pos = posFromLexentry(row.lexentry);

    let entry = entries.get(word);
    if (!entry) {
      entry = { buckets: [], score };
      entries.set(word, entry);
    }
    entry.score = Math.max(entry.score, score);

    let bucket = entry.buckets.find((b) => b.pos === pos);
    if (!bucket) {
      bucket = { pos, translations: [], senses: [], score };
      entry.buckets.push(bucket);
    }
    bucket.score = Math.max(bucket.score, score);

    for (const translation of translations) {
      if (bucket.translations.length >= 6) break;
      if (!bucket.translations.some((t) => normalize(t) === normalize(translation))) {
        bucket.translations.push(translation);
      }
    }

    const sense = row.sense?.trim();
    if (!sense || sense.length > 90 || bucket.senses.length >= 4) continue;
    if (bucket.senses.some((s) => s.sense.toLowerCase() === sense.toLowerCase())) continue;
    bucket.senses.push({ sense, translations });
  }
  log(`  → статей со значениями: ${senseRows.length.toLocaleString('ru')}`);

  // Слова, у которых значения не расписаны, добираем из упрощённой таблицы.
  const simpleRows = db
    .prepare<[], { written_rep: string; trans_list: string; max_score: number | null }>(
      'SELECT written_rep, trans_list, max_score FROM simple_translation WHERE written_rep IS NOT NULL AND trans_list IS NOT NULL',
    )
    .all();

  let fromSimple = 0;
  for (const row of simpleRows) {
    const word = row.written_rep.trim().toLowerCase();
    if (!word || entries.has(word)) continue;

    const translations = cleanTranslations(row.trans_list, word);
    if (translations.length === 0) continue;
    fromSimple++;
    const score = row.max_score ?? 0;
    entries.set(word, { buckets: [{ pos: null, translations, senses: [], score }], score });
  }
  log(`  → добрано из упрощённой таблицы: ${fromSimple.toLocaleString('ru')}`);

  db.close();

  for (const [word, entry] of entries) {
    entry.buckets = entry.buckets.filter((b) => b.translations.length > 0);
    entry.buckets.sort((a, b) => b.score - a.score);
    if (entry.buckets.length === 0) entries.delete(word);
  }
  log(`  → словарь в памяти: ${entries.size.toLocaleString('ru')} слов с русскими переводами`);
  return entries;
}

// ─────────────────────────────── сборка ───────────────────────────────

interface WordRow {
  text: string;
  translations: string;
  partOfSpeech: string | null;
  level: string;
  topic: string | null;
  gloss: string | null;
  senses: string | null;
  frequencyRank: number | null;
  source: string;
  license: string;
  isFunctionWord: boolean;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  log('\n╭─ Импорт словаря из открытых источников');
  log(`│  лимит: ${options.limit.toLocaleString('ru')} слов, минимальный score: ${options.minScore}`);
  log('│');
  log('├─ 1/4 Загрузка источников');

  const [frequency, cefr, translations] = await Promise.all([
    loadFrequency(options.refresh),
    loadCefrProfiles(options.refresh),
    loadTranslations(options.refresh),
  ]);

  log('│');
  log('├─ 2/4 Сборка списка слов');

  // Кандидаты: сначала по частотности (самое полезное вперёд), затем остальные
  // слова из профилей CEFR, которых не было в частотном списке.
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (word: string) => {
    if (seen.has(word)) return;
    seen.add(word);
    candidates.push(word);
  };

  for (const [word] of [...frequency.entries()].sort((a, b) => a[1] - b[1])) push(word);
  for (const word of [...cefr.keys()].sort()) push(word);

  log(`  → кандидатов: ${candidates.length.toLocaleString('ru')}`);

  const rows: WordRow[] = [];
  const skipped = { noTranslation: 0, lowScore: 0, badShape: 0, properNoun: 0 };
  const license = `${SOURCES.translations.license}; ${SOURCES.cefrj.license}`;

  for (const text of candidates) {
    if (rows.length >= options.limit) break;

    if (!/^[a-z][a-z' -]*$/.test(text) || text.length < 2) {
      skipped.badShape++;
      continue;
    }

    const entry = translations.get(text);
    if (!entry) {
      skipped.noTranslation++;
      continue;
    }
    if (entry.score < options.minScore) {
      skipped.lowScore++;
      continue;
    }

    const cefrEntry = cefr.get(text);
    const rank = frequency.get(text) ?? null;
    const level = cefrEntry?.level ?? levelFromFrequency(rank);

    // Часть речи из профиля CEFR надёжнее: она указывает, какое из значений
    // слова изучается на этом уровне.
    const bucket = resolveBucket(entry, cefrEntry?.pos ?? null);
    const pos = cefrEntry?.pos ?? bucket.pos;

    // Топонимы, бренды и имена — не лексика для тренировки перевода.
    if (pos === 'proper noun' || (!cefrEntry && looksLikeProperNoun(bucket.translations))) {
      skipped.properNoun++;
      continue;
    }

    // Пояснение берём из самого весомого значения — оно пригодится как подсказка.
    const gloss = bucket.senses[0]?.sense ?? null;

    rows.push({
      text,
      translations: JSON.stringify(bucket.translations),
      partOfSpeech: pos,
      level,
      topic: cefrEntry?.topic ?? null,
      gloss,
      senses: bucket.senses.length > 1 ? JSON.stringify(bucket.senses) : null,
      frequencyRank: rank,
      source: 'wikdict',
      license,
      isFunctionWord: isFunctionWord(text, pos),
    });
  }

  log(`  → отобрано: ${rows.length.toLocaleString('ru')}`);
  log(
    `  → пропущено: нет перевода ${skipped.noTranslation.toLocaleString('ru')}, слабый score ${skipped.lowScore.toLocaleString('ru')}, имена собственные ${skipped.properNoun.toLocaleString('ru')}, неподходящая форма ${skipped.badShape.toLocaleString('ru')}`,
  );

  log('│');
  log('├─ 3/4 Запись в базу');

  const existing = new Set(
    (await prisma.word.findMany({ where: { ownerId: null }, select: { text: true } })).map((w) => w.text),
  );
  const fresh = rows.filter((r) => !existing.has(r.text));
  log(`  → уже в базе: ${existing.size.toLocaleString('ru')}, добавляется: ${fresh.length.toLocaleString('ru')}`);

  const CHUNK = 1000;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    await prisma.word.createMany({ data: chunk });
    process.stdout.write(`\r  → записано ${Math.min(i + CHUNK, fresh.length).toLocaleString('ru')} / ${fresh.length.toLocaleString('ru')}`);
  }
  if (fresh.length > 0) process.stdout.write('\n');

  log('│');
  log('├─ 4/4 Итог');

  const total = await prisma.word.count({ where: { ownerId: null } });
  const trainable = await prisma.word.count({ where: { ownerId: null, isFunctionWord: false } });
  log(`  всего слов в базе: ${total.toLocaleString('ru')} (из них для тренировок: ${trainable.toLocaleString('ru')})`);

  for (const level of CEFR_LEVELS) {
    const count = await prisma.word.count({ where: { ownerId: null, level, isFunctionWord: false } });
    const bar = '█'.repeat(Math.round((count / Math.max(trainable, 1)) * 40));
    log(`  ${level}  ${String(count).padStart(5)}  ${bar}`);
  }

  const withSenses = await prisma.word.count({ where: { ownerId: null, senses: { not: null } } });
  const withGloss = await prisma.word.count({ where: { ownerId: null, gloss: { not: null } } });
  log(`  с пояснением: ${withGloss.toLocaleString('ru')}, с разбором по значениям: ${withSenses.toLocaleString('ru')}`);
  log(`╰─ Готово за ${((Date.now() - startedAt) / 1000).toFixed(1)} с\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n✖ Импорт не завершён:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
