/**
 * Нормализация и сверка ответов.
 *
 * Русские переводы из открытых словарей приходят с ударениями (приме́р) и в разных
 * вариантах написания, поэтому сравнение всегда идёт по нормализованной форме.
 */

/**
 * Только знаки ударения (акут и гравис). Убирать все диакритики нельзя:
 * в разложенной форме `й` — это `и` + U+0306, а `ё` — `е` + U+0308,
 * и они бы потерялись.
 */
const STRESS_MARKS = /[\u0300\u0301]/g;

/** Убирает знаки ударения, сохраняя букву (приме́р → пример, воробьёв → воробьёв). */
export function stripStress(input: string): string {
  return input.normalize('NFD').replace(STRESS_MARKS, '').normalize('NFC');
}

/**
 * Снимает вики-разметку из выгрузок Викисловаря.
 * `[[слово]]` → `слово`, `[[ссылка|текст]]` → `текст`,
 * а из перечисления форм `[[нести, несущий]]` берётся только первая форма.
 */
export function stripWikiMarkup(input: string): string {
  return input
    .replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
      const afterPipe = inner.includes('|') ? inner.slice(inner.lastIndexOf('|') + 1) : inner;
      return afterPipe.split(',')[0]!.trim();
    })
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Приводит ответ/перевод к канонической форме для сравнения:
 * нижний регистр, без ударений, ё→е, без пунктуации и лишних пробелов.
 */
export function normalize(input: string): string {
  return stripStress(input)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’`´]/g, "'")
    .replace(/[.,;:!?"()\[\]{}«»—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Нормализация английской стороны: дополнительно снимает инфинитивную частицу
 * «to» и неопределённые артикли, чтобы «to run» и «run» считались одним ответом.
 */
export function normalizeEnglish(input: string): string {
  return normalize(input).replace(/^(to|a|an|the)\s+/, '');
}

/** Расстояние Левенштейна с ранним выходом по лимиту. */
export function levenshtein(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > limit) return limit + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Сколько опечаток прощаем в слове данной длины.
 * Короткие слова — строго, иначе «дом»/«том» зачтётся как верный ответ.
 */
export function typoBudget(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

export type MatchType = 'exact' | 'alternative' | 'typo' | 'wrong';

export interface MatchResult {
  isCorrect: boolean;
  matchType: MatchType;
  /** Перевод из словаря, к которому ближе всего ответ пользователя. */
  matched: string | null;
  /** Насколько ответ близок к цели, 0..1 — для аналитики. */
  similarity: number;
}

export interface MatchOptions {
  /** Разрешить зачёт ответа с одной-двумя опечатками. */
  allowTypos?: boolean;
  /** Английская сторона: снимать «to»/артикли. */
  english?: boolean;
}

/**
 * Сверяет ответ пользователя со списком допустимых переводов.
 * Первый элемент `accepted` считается основным вариантом: совпадение с ним —
 * `exact`, с остальными — `alternative`.
 */
export function matchAnswer(given: string, accepted: string[], options: MatchOptions = {}): MatchResult {
  const norm = options.english ? normalizeEnglish : normalize;
  const answer = norm(given);

  if (!answer) {
    return { isCorrect: false, matchType: 'wrong', matched: null, similarity: 0 };
  }

  const variants = accepted
    .map((raw) => ({ raw, key: norm(raw) }))
    .filter((v) => v.key.length > 0);

  // Точное совпадение.
  for (const [index, variant] of variants.entries()) {
    if (variant.key === answer) {
      return {
        isCorrect: true,
        matchType: index === 0 ? 'exact' : 'alternative',
        matched: variant.raw,
        similarity: 1,
      };
    }
  }

  // Пользователь мог перечислить несколько значений через запятую или слэш —
  // достаточно, чтобы хотя бы одна его часть совпала с любым переводом.
  const parts = answer.split(/[\/,]|\s+или\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      for (const variant of variants) {
        if (variant.key === part) {
          return { isCorrect: true, matchType: 'alternative', matched: variant.raw, similarity: 1 };
        }
      }
    }
  }

  // Ближайший вариант — и для прощения опечаток, и для оценки «насколько близко».
  let best: { variant: (typeof variants)[number]; distance: number } | null = null;
  for (const variant of variants) {
    const distance = levenshtein(answer, variant.key, 3);
    if (!best || distance < best.distance) best = { variant, distance };
  }

  if (!best) {
    return { isCorrect: false, matchType: 'wrong', matched: null, similarity: 0 };
  }

  const targetLength = best.variant.key.length;
  const similarity = Math.max(0, 1 - best.distance / Math.max(answer.length, targetLength));

  if (options.allowTypos !== false && best.distance <= typoBudget(targetLength) && best.distance > 0) {
    return { isCorrect: true, matchType: 'typo', matched: best.variant.raw, similarity };
  }

  return { isCorrect: false, matchType: 'wrong', matched: best.variant.raw, similarity };
}

/** Красивое отображение перевода: без ударений, с заглавной буквы не трогаем. */
export function displayTranslation(raw: string): string {
  return stripStress(raw).trim();
}

const VOWELS = 'aeiou';

/**
 * Приблизительные словоформы английского слова: нужны, чтобы узнать слово
 * в живой фразе («study» → «studies», «studied», «studying»).
 * Морфология намеренно грубая — формы служат ключом поиска, а найденное
 * предложение всё равно проверяется по границе слова, так что лишние
 * варианты просто ни с чем не совпадут.
 */
export function englishWordForms(word: string): string[] {
  const base = word.toLowerCase().trim();
  if (!/^[a-z][a-z']+$/.test(base)) return base ? [base] : [];

  const forms = new Set<string>([base]);
  const last = base.at(-1)!;
  const beforeLast = base.at(-2) ?? '';

  if (/(?:s|x|z|ch|sh)$/.test(base)) {
    forms.add(`${base}es`);
  } else if (last === 'y' && !VOWELS.includes(beforeLast)) {
    forms.add(`${base.slice(0, -1)}ies`);
    forms.add(`${base.slice(0, -1)}ied`);
  } else {
    forms.add(`${base}s`);
  }

  if (last === 'e') {
    forms.add(`${base}d`);
    forms.add(`${base.slice(0, -1)}ing`);
  } else if (last !== 'y' || VOWELS.includes(beforeLast)) {
    forms.add(`${base}ed`);
    forms.add(`${base}ing`);
  }

  // Закрытый односложный корень удваивает согласную: stop → stopped, stopping.
  if (base.length >= 3 && !VOWELS.includes(last) && VOWELS.includes(beforeLast) && !'wxy'.includes(last)) {
    forms.add(`${base}${last}ed`);
    forms.add(`${base}${last}ing`);
  }

  return [...forms];
}

/** Слова фразы в нижнем регистре — для поиска по корпусу. */
export function tokenizeEnglish(sentence: string): string[] {
  return sentence.toLowerCase().match(/[a-z][a-z']*/g) ?? [];
}

/** Есть ли слово (в любой из своих форм) в английской фразе. */
export function containsWord(sentence: string, word: string): boolean {
  const forms = new Set(englishWordForms(word));
  if (word.includes(' ')) return sentence.toLowerCase().includes(word.toLowerCase());
  return tokenizeEnglish(sentence).some((token) => forms.has(token));
}

/** Безопасный разбор JSON-поля с массивом строк. */
export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
