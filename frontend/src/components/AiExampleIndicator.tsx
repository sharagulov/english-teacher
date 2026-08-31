import { Sparkles } from 'lucide-react';
export function AiExampleIndicator() {
    return (<span className="text-faint inline-flex shrink-0" title="Предложение сгенерировано" aria-label="Предложение сгенерировано">
      <Sparkles size={12} strokeWidth={1.75} aria-hidden="true"/>
    </span>);
}
export function isAiGeneratedExample(source: string): boolean {
    return source === 'ai';
}
