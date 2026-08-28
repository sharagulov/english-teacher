import { ThumbsDown } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useUi } from '../store/ui';
import { cx } from './ui';

export type DislikeLevel = 0 | 1 | 2;

const TITLES: Record<DislikeLevel, string> = {
  0: 'Реже в тренировке. Повторно — почти не показывать.',
  1: 'Почти не показывать это слово. Ещё раз — вернуть.',
  2: 'Слово почти скрыто из тренировки. Нажмите, чтобы вернуть.',
};

function asLevel(value: number): DislikeLevel {
  if (value >= 2) return 2;
  if (value <= 0) return 0;
  return 1;
}

export function DislikeButton({
  wordId,
  level,
  onChange,
  size = 'md',
  className,
}: {
  wordId: number;
  level: number;
  onChange: (level: DislikeLevel) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const notify = useUi((state) => state.notify);
  const [busy, setBusy] = useState(false);
  const current = asLevel(level);

  const onClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const next: DislikeLevel = current >= 2 ? 0 : ((current + 1) as DislikeLevel);
    setBusy(true);
    try {
      const response = await api.words.dislike(wordId, { level: next });
      onChange(asLevel(response.dislikeLevel));
    } catch (cause) {
      notify({
        title: cause instanceof ApiError ? cause.message : 'Не удалось сохранить отметку',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      data-dislike-button
      title={TITLES[current]}
      aria-label={TITLES[current]}
      aria-pressed={current > 0}
      disabled={busy}
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
        size === 'sm' ? 'h-8 w-8' : 'h-9 w-9',
        current === 0 && 'text-faint hover:bg-sunken hover:text-ink',
        current === 1 && 'text-soft bg-sunken hover:text-ink',
        current === 2 && 'bg-sunken text-ink',
        busy && 'opacity-60',
        className,
      )}
    >
      <ThumbsDown
        size={size === 'sm' ? 15 : 17}
        strokeWidth={1.75}
        fill={current === 0 ? 'none' : 'currentColor'}
        fillOpacity={current === 1 ? 0.3 : current === 2 ? 0.75 : 0}
        aria-hidden="true"
      />
      {current > 0 ? (
        <span className="text-faint absolute -right-0.5 -bottom-0.5 text-[9px] font-medium tabular-nums leading-none">
          {current}
        </span>
      ) : null}
    </button>
  );
}
