let cachedVoice: SpeechSynthesisVoice | null = null;
export function speechSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
function pickVoice(): SpeechSynthesisVoice | null {
    if (cachedVoice)
        return cachedVoice;
    if (!speechSupported())
        return null;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0)
        return null;
    const preferred = voices.find((v) => /en-GB/i.test(v.lang)) ??
        voices.find((v) => /en-US/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
    cachedVoice = preferred;
    return preferred;
}
if (speechSupported()) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
        cachedVoice = null;
        pickVoice();
    });
}
export interface SpeakOptions {
    rate?: number;
    onEnd?: () => void;
}
export function speak(text: string, options: SpeakOptions = {}): void {
    if (!speechSupported() || !text.trim())
        return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    utterance.rate = options.rate ?? 0.95;
    const voice = pickVoice();
    if (voice)
        utterance.voice = voice;
    if (options.onEnd)
        utterance.addEventListener('end', options.onEnd);
    window.speechSynthesis.speak(utterance);
}
export function stopSpeaking(): void {
    if (speechSupported())
        window.speechSynthesis.cancel();
}
export function playPronunciation(text: string, audioUrl?: string | null): void {
    if (audioUrl) {
        const audio = new Audio(audioUrl);
        audio.play().catch(() => speak(text));
        return;
    }
    speak(text);
}
