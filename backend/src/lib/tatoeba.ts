/**
 * Чтение параллельного корпуса Tatoeba (англо-русские пары предложений).
 *
 * Сам Tatoeba раздаёт дампы в bzip2, который Node без сторонних библиотек
 * не распаковывает, поэтому берём выгрузку того же корпуса из OPUS в формате
 * TMX + gzip: один файл на 15 МБ, распаковывается штатным zlib.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { ensureSource } from './sources.js';

export interface SentencePair {
  en: string;
  ru: string;
}

/** Версия дампа — сохраняем её у примеров как ссылку на источник. */
export const CORPUS_REF = 'OPUS-Tatoeba v2023-04-12';

const SEGMENT = /<tuv xml:lang="(\w+)"><seg>(.*?)<\/seg><\/tuv>/g;

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    // Амперсанд разворачиваем последним, иначе «&amp;lt;» превратится в «<».
    .replace(/&amp;/g, '&');
}

/**
 * Отдаёт пары предложений по мере чтения файла: корпус целиком в память
 * не помещаем, он на порядок больше самой базы.
 */
export async function* readSentencePairs(
  options: { refresh?: boolean; onProgress?: (message: string) => void } = {},
): AsyncGenerator<SentencePair> {
  const file = await ensureSource('examples', options);
  const lines = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let en = '';
  let ru = '';

  for await (const line of lines) {
    for (const match of line.matchAll(SEGMENT)) {
      const value = unescapeXml(match[2] ?? '').trim();
      if (match[1] === 'en') en = value;
      else if (match[1] === 'ru') ru = value;
    }

    if (line.includes('</tu>')) {
      if (en && ru) yield { en, ru };
      en = '';
      ru = '';
    }
  }
}
