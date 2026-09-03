import { SegmentedControl } from './ui';
import type { ClassicDirection } from '../lib/types';

const DIRECTION_OPTIONS = [
    { value: 'en_ru' as const, label: 'EN → RU' },
    { value: 'ru_en' as const, label: 'RU → EN' },
] as const;

const ANSWER_FORMAT_OPTIONS = [
    { value: 'typed' as const, label: 'Ввод' },
    { value: 'choice' as const, label: '4 варианта' },
] as const;

export function DirectionSwitch({ value, onChange, className, }: {
    value: ClassicDirection;
    onChange: (value: ClassicDirection) => void;
    className?: string;
}) {
    return (<SegmentedControl value={value} onChange={onChange} options={DIRECTION_OPTIONS} aria-label="Направление перевода" className={className}/>);
}
export function AnswerFormatSwitch({ value, onChange, className, }: {
    value: 'typed' | 'choice';
    onChange: (value: 'typed' | 'choice') => void;
    className?: string;
}) {
    return (<SegmentedControl value={value} onChange={onChange} options={ANSWER_FORMAT_OPTIONS} aria-label="Формат ответа" className={className}/>);
}
export function sentenceTaskDirection(type: string): ClassicDirection {
    return type === 'sentence_ru_en' ? 'ru_en' : 'en_ru';
}
export function directionToSentenceTask(direction: ClassicDirection): 'sentence_en_ru' | 'sentence_ru_en' {
    return direction === 'ru_en' ? 'sentence_ru_en' : 'sentence_en_ru';
}
export function isSentenceTaskType(type: string): boolean {
    return type === 'sentence_en_ru' || type === 'sentence_ru_en';
}
