import { prisma } from '../db.js';
const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
interface DictionaryApiPhonetic {
    text?: string;
    audio?: string;
}
interface DictionaryApiDefinition {
    definition?: string;
    example?: string;
}
interface DictionaryApiMeaning {
    partOfSpeech?: string;
    definitions?: DictionaryApiDefinition[];
}
interface DictionaryApiEntry {
    word?: string;
    phonetic?: string;
    phonetics?: DictionaryApiPhonetic[];
    meanings?: DictionaryApiMeaning[];
}
export interface Enrichment {
    transcription: string | null;
    audioUrl: string | null;
    example: string | null;
    definition: string | null;
}
const TIMEOUT_MS = 2500;
const recentFailures = new Map<number, number>();
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
async function fetchFromDictionaryApi(word: string): Promise<Enrichment | null> {
    try {
        const response = await fetch(ENDPOINT + encodeURIComponent(word), {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { Accept: 'application/json' },
        });
        if (!response.ok)
            return null;
        const entries = (await response.json()) as DictionaryApiEntry[];
        if (!Array.isArray(entries) || entries.length === 0)
            return null;
        const transcription = entries.find((e) => e.phonetic)?.phonetic ??
            entries.flatMap((e) => e.phonetics ?? []).find((p) => p.text)?.text ??
            null;
        const audioUrl = entries.flatMap((e) => e.phonetics ?? []).find((p) => p.audio)?.audio ?? null;
        const definitions = entries.flatMap((e) => e.meanings ?? []).flatMap((m) => m.definitions ?? []);
        const example = definitions.find((d) => d.example && d.example.length <= 160)?.example ?? null;
        const definition = definitions.find((d) => d.definition)?.definition ?? null;
        return { transcription, audioUrl, example, definition };
    }
    catch {
        return null;
    }
}
function shouldSkip(wordId: number, enrichedAt: Date | null): boolean {
    if (enrichedAt)
        return true;
    const failedAt = recentFailures.get(wordId);
    return failedAt != null && Date.now() - failedAt < FAILURE_COOLDOWN_MS;
}
export async function enrichWord(wordId: number) {
    const word = await prisma.word.findUniqueOrThrow({ where: { id: wordId } });
    if (shouldSkip(wordId, word.enrichedAt))
        return word;
    const enrichment = await fetchFromDictionaryApi(word.text);
    if (!enrichment) {
        recentFailures.set(wordId, Date.now());
        return word;
    }
    recentFailures.delete(wordId);
    return prisma.word.update({
        where: { id: wordId },
        data: {
            enrichedAt: new Date(),
            transcription: enrichment.transcription ?? word.transcription,
            audioUrl: enrichment.audioUrl ?? word.audioUrl,
            example: enrichment.example ?? word.example,
            gloss: word.gloss ?? enrichment.definition ?? null,
        },
    });
}
