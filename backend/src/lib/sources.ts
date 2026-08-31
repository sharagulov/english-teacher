import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const SOURCES = {
    frequency: {
        url: 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt',
        file: 'google-10000-english.txt',
        license: 'Public Domain (google-10000-english)',
    },
    cefrj: {
        url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv',
        file: 'cefrj-vocabulary-profile-1.5.csv',
        license: 'CEFR-J Vocabulary Profile 1.5 (CEFR-J project)',
    },
    octanove: {
        url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv',
        file: 'octanove-vocabulary-profile-c1c2-1.0.csv',
        license: 'Octanove Vocabulary Profile C1/C2 1.0 (Octanove Labs)',
    },
    grammar: {
        url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-grammar-profile-20180315.csv',
        file: 'cefrj-grammar-profile.csv',
        license: 'CEFR-J Grammar Profile (CEFR-J project)',
    },
    translations: {
        url: 'https://download.wikdict.com/dictionaries/sqlite/2_2026-06/en-ru.sqlite3',
        file: 'en-ru.sqlite3',
        license: 'WikDict en-ru (CC BY-SA 3.0, данные Викисловаря)',
    },
    examples: {
        url: 'https://object.pouta.csc.fi/OPUS-Tatoeba/v2023-04-12/tmx/en-ru.tmx.gz',
        file: 'tatoeba-en-ru.tmx.gz',
        license: 'Tatoeba en-ru (CC BY 2.0 FR, выгрузка OPUS)',
    },
} as const;
export type SourceKey = keyof typeof SOURCES;
export const CACHE_DIR = path.resolve(process.cwd(), '.cache');
interface DownloadOptions {
    refresh?: boolean;
    onProgress?: (message: string) => void;
}
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
        }
        catch {
        }
    }
    options.onProgress?.(`  ${source.file} — скачиваю…`);
    const started = Date.now();
    const response = await fetch(source.url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!response.ok) {
        throw new Error(`Не удалось скачать ${source.url}: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(target, buffer);
    options.onProgress?.(`  ${source.file} — готово (${formatSize(buffer.length)} за ${((Date.now() - started) / 1000).toFixed(1)} с)`);
    return target;
}
export async function readTextSource(key: SourceKey, options: DownloadOptions = {}): Promise<string> {
    const file = await ensureSource(key, options);
    return readFile(file, 'utf8');
}
export function formatSize(bytes: number): string {
    if (bytes < 1024)
        return `${bytes} Б`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
export const ATTRIBUTION = Object.values(SOURCES).map((s) => s.license);
