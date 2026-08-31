import { prisma } from '../db.js';
import { env } from '../env.js';
import { SCHEMAS, TUTOR_SYSTEM, ask, wordExamplesSchema } from '../lib/ai.js';
import { CORPUS_REF, readSentencePairs } from '../lib/tatoeba.js';
import { containsWord, englishWordForms, parseStringArray, tokenizeEnglish } from '../lib/text.js';
export interface WordExampleView {
    text: string;
    translation: string | null;
    source: string;
}
export const EXAMPLES_PER_WORD = 3;
const MIN_TOKENS = 4;
const MAX_TOKENS = 14;
const MAX_CHARS = 100;
const MAX_TRANSLATION_CHARS = 140;
const CORPUS_POSITION = 0;
const AI_POSITION = 10;
interface NewExample {
    wordId: number;
    text: string;
    translation: string | null;
    source: string;
    sourceRef: string | null;
    position: number;
}
async function insertExamples(rows: NewExample[]): Promise<number> {
    const CHUNK = 400;
    let written = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        try {
            const result = await prisma.wordExample.createMany({ data: chunk });
            written += result.count;
        }
        catch {
            for (const row of chunk) {
                try {
                    await prisma.wordExample.create({ data: row });
                    written++;
                }
                catch {
                }
            }
        }
    }
    return written;
}
interface Candidate {
    text: string;
    translation: string;
    score: number;
}
interface Target {
    id: number;
    text: string;
    phrase: boolean;
    best: Candidate[];
}
function scoreSentence(tokens: string[], en: string, ru: string, exactForm: boolean): number {
    let score = 100;
    if (exactForm)
        score += 30;
    score -= Math.abs(tokens.length - 8) * 4;
    if (/[.!?]$/.test(en))
        score += 8;
    if (/\d/.test(en))
        score -= 25;
    if (/["“”«»()[\]]/.test(en))
        score -= 15;
    if (ru.length > 90)
        score -= 10;
    return score;
}
function consider(target: Target, candidate: Candidate): void {
    if (target.best.some((item) => item.text === candidate.text))
        return;
    target.best.push(candidate);
    target.best.sort((a, b) => b.score - a.score);
    if (target.best.length > EXAMPLES_PER_WORD)
        target.best.length = EXAMPLES_PER_WORD;
}
export interface CorpusPassResult {
    words: number;
    examples: number;
}
async function runCorpusPass(onProgress?: (message: string) => void): Promise<CorpusPassResult> {
    const words = await prisma.word.findMany({
        where: { examplesAt: null },
        select: { id: true, text: true },
    });
    if (words.length === 0)
        return { words: 0, examples: 0 };
    const targets: Target[] = [];
    const byForm = new Map<string, {
        target: Target;
        exact: boolean;
    }[]>();
    for (const word of words) {
        const target: Target = { id: word.id, text: word.text, phrase: word.text.includes(' '), best: [] };
        targets.push(target);
        const keys = target.phrase ? [word.text.split(' ')[0]!] : englishWordForms(word.text);
        for (const key of keys) {
            const entry = { target, exact: key === word.text };
            const bucket = byForm.get(key);
            if (bucket)
                bucket.push(entry);
            else
                byForm.set(key, [entry]);
        }
    }
    onProgress?.(`  подбираю примеры для ${words.length.toLocaleString('ru')} слов`);
    let scanned = 0;
    for await (const pair of readSentencePairs({ onProgress })) {
        scanned++;
        if (pair.en.length > MAX_CHARS || pair.ru.length > MAX_TRANSLATION_CHARS)
            continue;
        const tokens = tokenizeEnglish(pair.en);
        if (tokens.length < MIN_TOKENS || tokens.length > MAX_TOKENS)
            continue;
        const lower = pair.en.toLowerCase();
        const touched = new Set<number>();
        for (const token of tokens) {
            const bucket = byForm.get(token);
            if (!bucket)
                continue;
            for (const { target, exact } of bucket) {
                if (touched.has(target.id))
                    continue;
                touched.add(target.id);
                if (target.phrase && !lower.includes(target.text))
                    continue;
                consider(target, {
                    text: pair.en,
                    translation: pair.ru,
                    score: scoreSentence(tokens, pair.en, pair.ru, exact),
                });
            }
        }
    }
    onProgress?.(`  просмотрено фраз: ${scanned.toLocaleString('ru')}`);
    const rows: NewExample[] = [];
    for (const target of targets) {
        target.best.forEach((candidate, index) => {
            rows.push({
                wordId: target.id,
                text: candidate.text,
                translation: candidate.translation,
                source: 'tatoeba',
                sourceRef: CORPUS_REF,
                position: CORPUS_POSITION + index,
            });
        });
    }
    const examples = await insertExamples(rows);
    const now = new Date();
    const ids = targets.map((target) => target.id);
    for (let i = 0; i < ids.length; i += 400) {
        await prisma.word.updateMany({
            where: { id: { in: ids.slice(i, i + 400) } },
            data: { examplesAt: now },
        });
    }
    return { words: words.length, examples };
}
let corpusPass: Promise<CorpusPassResult> | null = null;
let corpusFailedAt = 0;
const CORPUS_RETRY_MS = 30 * 60 * 1000;
function ensureCorpusPass(onProgress?: (message: string) => void): Promise<CorpusPassResult> {
    if (corpusPass)
        return corpusPass;
    if (Date.now() - corpusFailedAt < CORPUS_RETRY_MS)
        return Promise.resolve({ words: 0, examples: 0 });
    corpusPass = runCorpusPass(onProgress).catch((error: unknown) => {
        corpusFailedAt = Date.now();
        corpusPass = null;
        throw error;
    });
    return corpusPass;
}
export function importCorpusExamples(onProgress: (message: string) => void): Promise<CorpusPassResult> {
    return runCorpusPass(onProgress);
}
const AI_BATCH_SIZE = 6;
const AI_MAX_BATCHES = 4;
const recentAiFailures = new Map<number, number>();
const AI_COOLDOWN_MS = 60 * 60 * 1000;
function skipAi(wordId: number): boolean {
    const failedAt = recentAiFailures.get(wordId);
    return failedAt != null && Date.now() - failedAt < AI_COOLDOWN_MS;
}
function rememberAiOutcome(wordIds: number[], covered: Set<number>): void {
    const now = Date.now();
    for (const id of wordIds) {
        if (covered.has(id))
            recentAiFailures.delete(id);
        else
            recentAiFailures.set(id, now);
    }
}
interface WordForAi {
    id: number;
    text: string;
    translations: string;
}
async function generateExamples(words: WordForAi[]): Promise<Set<number>> {
    const list = words
        .map((word) => `${word.text} — ${parseStringArray(word.translations).slice(0, 2).join(', ')}`)
        .join('; ');
    const generated = await ask({
        system: TUTOR_SYSTEM,
        user: `Для каждого слова из списка придумай два коротких примера употребления. ` +
            `Требования к предложению: 5–10 слов, живая разговорная речь, простая грамматика, ` +
            `слово обязательно есть в предложении (можно в другой форме), а контекст ясно показывает нужное значение. ` +
            `word — слово из списка без изменений; en — предложение на английском; ru — его перевод на русский.` +
            `\n\nСлова: ${list}`,
        responseFormat: SCHEMAS.wordExamples,
        temperature: 0.7,
        maxTokens: 1600,
    }, wordExamplesSchema);
    const byText = new Map(words.map((word) => [word.text.toLowerCase(), word]));
    const rows: NewExample[] = [];
    for (const item of generated.items) {
        const word = byText.get(item.word.trim().toLowerCase());
        if (!word)
            continue;
        let position = AI_POSITION;
        for (const example of item.examples) {
            const text = example.en.trim();
            const translation = example.ru.trim();
            if (text.length < 10 || text.length > 140 || !containsWord(text, word.text))
                continue;
            if (rows.some((row) => row.wordId === word.id && row.text === text))
                continue;
            rows.push({
                wordId: word.id,
                text,
                translation: translation || null,
                source: 'ai',
                sourceRef: env.OPENAI_MODEL,
                position: position++,
            });
        }
    }
    await insertExamples(rows);
    return new Set(rows.map((row) => row.wordId));
}
async function wordsWithoutExamples(wordIds: number[]) {
    return prisma.word.findMany({
        where: { id: { in: wordIds }, example: null, examples: { none: {} } },
        select: { id: true, text: true, translations: true, examplesAt: true },
    });
}
async function fillExamples(wordIds: number[]): Promise<void> {
    if (wordIds.length === 0)
        return;
    let missing = await wordsWithoutExamples(wordIds);
    if (missing.length === 0)
        return;
    if (missing.some((word) => word.examplesAt == null)) {
        await ensureCorpusPass();
        missing = await wordsWithoutExamples(wordIds);
    }
    if (!env.aiEnabled)
        return;
    const budget = missing.filter((word) => !skipAi(word.id)).slice(0, AI_BATCH_SIZE * AI_MAX_BATCHES);
    for (let i = 0; i < budget.length; i += AI_BATCH_SIZE) {
        const batch = budget.slice(i, i + AI_BATCH_SIZE);
        try {
            rememberAiOutcome(batch.map((word) => word.id), await generateExamples(batch));
        }
        catch {
            break;
        }
    }
}
export function prefetchExamples(wordIds: number[]): void {
    void fillExamples(wordIds).catch(() => {
    });
}
export function warmupExamples(log: (message: string) => void): void {
    void (async () => {
        const pending = await prisma.word.count({ where: { examplesAt: null } });
        if (pending === 0)
            return;
        log(`Подбираю примеры употребления для ${pending} слов (фоном, из корпуса Tatoeba)`);
        const result = await ensureCorpusPass();
        log(`Примеры готовы: ${result.examples} фраз для ${result.words} слов`);
    })().catch(() => {
    });
}
function fallbackExample(word: {
    example: string | null;
    exampleRu: string | null;
}): WordExampleView[] {
    return word.example ? [{ text: word.example, translation: word.exampleRu, source: 'dictionary' }] : [];
}
export async function examplesForWords(wordIds: number[], limit = EXAMPLES_PER_WORD): Promise<Map<number, WordExampleView[]>> {
    const grouped = new Map<number, WordExampleView[]>();
    if (wordIds.length === 0)
        return grouped;
    const rows = await prisma.wordExample.findMany({
        where: { wordId: { in: wordIds } },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
        const list = grouped.get(row.wordId) ?? [];
        if (list.length >= limit)
            continue;
        list.push({ text: row.text, translation: row.translation, source: row.source });
        grouped.set(row.wordId, list);
    }
    return grouped;
}
export async function examplesForWord(wordId: number, limit = EXAMPLES_PER_WORD): Promise<WordExampleView[]> {
    const [found, word] = await Promise.all([
        examplesForWords([wordId], limit),
        prisma.word.findUnique({ where: { id: wordId }, select: { example: true, exampleRu: true } }),
    ]);
    const list = found.get(wordId) ?? [];
    return list.length > 0 || !word ? list : fallbackExample(word);
}
export async function ensureExamplesForWord(wordId: number): Promise<WordExampleView[]> {
    const existing = await examplesForWord(wordId);
    if (existing.length > 0)
        return existing;
    void ensureCorpusPass().catch(() => {
    });
    if (env.aiEnabled && !skipAi(wordId)) {
        const word = await prisma.word.findUnique({
            where: { id: wordId },
            select: { id: true, text: true, translations: true },
        });
        if (word) {
            try {
                rememberAiOutcome([wordId], await generateExamples([word]));
            }
            catch {
            }
        }
    }
    return examplesForWord(wordId);
}
