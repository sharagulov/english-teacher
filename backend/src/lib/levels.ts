export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];
export function isCefrLevel(value: string): value is CefrLevel {
    return (CEFR_LEVELS as readonly string[]).includes(value);
}
export function levelIndex(level: string): number {
    const index = (CEFR_LEVELS as readonly string[]).indexOf(level);
    return index === -1 ? 1 : index;
}
export function levelsUpTo(target: string): CefrLevel[] {
    const index = levelIndex(target);
    return CEFR_LEVELS.slice(0, Math.min(index + 2, CEFR_LEVELS.length));
}
export function levelFromFrequency(rank: number | null | undefined): CefrLevel {
    if (rank == null)
        return 'C1';
    if (rank <= 600)
        return 'A1';
    if (rank <= 1600)
        return 'A2';
    if (rank <= 3200)
        return 'B1';
    if (rank <= 5500)
        return 'B2';
    if (rank <= 8500)
        return 'C1';
    return 'C2';
}
const POS_ALIASES: Record<string, string> = {
    noun: 'noun',
    nouns: 'noun',
    verb: 'verb',
    'do-verb': 'auxiliary',
    'be-verb': 'auxiliary',
    'modal verb': 'auxiliary',
    modal: 'auxiliary',
    auxiliary: 'auxiliary',
    adjective: 'adjective',
    adverb: 'adverb',
    determiner: 'determiner',
    pronoun: 'pronoun',
    preposition: 'preposition',
    conjunction: 'conjunction',
    interjection: 'interjection',
    exclamation: 'interjection',
    number: 'numeral',
    numeral: 'numeral',
    phrase: 'phrase',
    idiom: 'phrase',
    prefix: 'affix',
    suffix: 'affix',
    'proper noun': 'proper noun',
    participle: 'verb',
};
export function normalizePos(raw: string | null | undefined): string | null {
    if (!raw)
        return null;
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    return POS_ALIASES[key] ?? (key.length > 0 ? key : null);
}
const FUNCTION_POS = new Set(['determiner', 'pronoun', 'preposition', 'conjunction', 'auxiliary', 'numeral', 'affix', 'interjection']);
const FUNCTION_WORDS = new Set([
    'a', 'an', 'the', 'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
    'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'shall', 'should',
    'can', 'could', 'may', 'might', 'must', 'ought',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
    'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which', 'what',
    'and', 'or', 'but', 'if', 'because', 'as', 'than', 'so', 'nor', 'yet',
    'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto',
    'not', 'no', 's', 't', 'll', 've', 're', 'd', 'm',
]);
export function isFunctionWord(text: string, pos: string | null): boolean {
    if (FUNCTION_WORDS.has(text))
        return true;
    return pos != null && FUNCTION_POS.has(pos);
}
