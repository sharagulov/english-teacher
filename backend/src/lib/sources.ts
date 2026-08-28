import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Открытые источники данных. Скачиваются один раз и кешируются в backend/.cache,
 * дальше приложение работает полностью из своей БД.
 */
export const SOURCES = {
  /** Частотный список английских слов. Public Domain. */
  frequency: {
    url: 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt',
    file: 'google-10000-english.txt',
    license: 'Public Domain (google-10000-english)',
  },
  /** Уровни CEFR A1–B2 + тематические категории. CEFR-J project. */
  cefrj: {
    url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv',
    file: 'cefrj-vocabulary-profile-1.5.csv',
    license: 'CEFR-J Vocabulary Profile 1.5 (CEFR-J project)',
  },
  /** Уровни CEFR C1–C2. Octanove Labs. */
  octanove: {
    url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv',
    file: 'octanove-vocabulary-profile-c1c2-1.0.csv',
    license: 'Octanove Vocabulary Profile C1/C2 1.0 (Octanove Labs)',
  },
  /** Грамматические конструкции по уровням — используется для ИИ-тестов. */
  grammar: {
    url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-grammar-profile-20180315.csv',
    file: 'cefrj-grammar-profile.csv',
    license: 'CEFR-J Grammar Profile (CEFR-J project)',
  },
  /** Англо-русский словарь, извлечённый из Викисловаря. CC BY-SA 3.0. */
  translations: {
    url: 'https://download.wikdict.com/dictionaries/sqlite/2_2026-06/en-ru.sqlite3',
    file: 'en-ru.sqlite3',
    license: 'WikDict en-ru (CC BY-SA 3.0, данные Викисловаря)',
  },
} as const;

export type SourceKey = keyof typeof SOURCES;

export const CACHE_DIR = path.resolve(process.cwd(), '.cache');

interface DownloadOptions {
  /** Скачать заново, даже если файл уже в кеше. */
  refresh?: boolean;
  onProgress?: (message: string) => void;
}

/** Скачивает файл источника в кеш (если его там ещё нет) и возвращает путь. */
export async function ensureSource(key: SourceKey, options: DownloadOptions = {}): Promise<string> {
  const source = SOURCES[key];
  const target = path.join(CACHE_DIR, source.file);
  await mkdir(CACHE_DIR, { recursive: true });

  if (!options.refresh) {
    try {
      const info = await stat(target);
      if (info.size > 0) {
        options.onProgress?.(`  ${source.file} — из кеша (${formatSize(info.size)})`);
        return target;
      }
    } catch {
      // файла нет — качаем
    }
  }

  options.onProgress?.(`  ${source.file} — скачиваю…`);
  const started = Date.now();
  const response = await fetch(source.url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  if (!response.ok) {
    throw new Error(`Не удалось скачать ${source.url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(target, buffer);
  options.onProgress?.(
    `  ${source.file} — готово (${formatSize(buffer.length)} за ${((Date.now() - started) / 1000).toFixed(1)} с)`,
  );
  return target;
}

/** Читает текстовый источник из кеша, при необходимости скачав его. */
export async function readTextSource(key: SourceKey, options: DownloadOptions = {}): Promise<string> {
  const file = await ensureSource(key, options);
  return readFile(file, 'utf8');
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/** Строка атрибуции для README и футера приложения. */
export const ATTRIBUTION = Object.values(SOURCES).map((s) => s.license);
