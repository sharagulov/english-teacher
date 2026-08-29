import type { ClassicDirection } from '../lib/types';
import { LabeledSwitch } from './Switch';

/** Переключатель направления перевода — обёртка над LabeledSwitch. */
export function DirectionSwitch({
  value,
  onChange,
  className,
}: {
  value: ClassicDirection;
  onChange: (value: ClassicDirection) => void;
  className?: string;
}) {
  const reversed = value === 'ru_en';

  return (
    <LabeledSwitch
      leftLabel="EN → RU"
      rightLabel="RU → EN"
      checked={reversed}
      onChange={(checked) => onChange(checked ? 'ru_en' : 'en_ru')}
      aria-label={reversed ? 'С русского на английский' : 'С английского на русский'}
      className={className}
    />
  );
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
