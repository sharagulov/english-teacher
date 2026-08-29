import { useEffect, useMemo, useState } from 'react';
import { AiExampleIndicator, isAiGeneratedExample } from '../components/AiExampleIndicator';
import { DislikeButton } from '../components/DislikeButton';
import { Switch } from '../components/Switch';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Textarea,
  cx,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import {
  PART_OF_SPEECH_LABELS,
  WORD_STATUS_LABELS,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  formatResponseTime,
  splitAroundWord,
} from '../lib/format';
import { playPronunciation } from '../lib/speech';
import type { CefrLevel, DictionaryWord, WordStatus } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useUi } from '../store/ui';

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const PER_PAGE = 40;

const STATUS_TONE: Record<WordStatus, 'neutral' | 'accent' | 'success' | 'danger' | 'warning'> = {
  new: 'neutral',
  learning: 'warning',
  review: 'accent',
  mastered: 'success',
  leech: 'danger',
};

export function Dictionary() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [level, setLevel] = useState<CefrLevel | ''>('');
  const [topic, setTopic] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('');
  const [onlyUnseen, setOnlyUnseen] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Поиск не должен дёргать сервер на каждое нажатие.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const meta = useAsync(() => api.words.meta(), []);
  const health = useAsync(() => api.health(), []);
  const words = useAsync(
    () =>
      api.words.list({
        page,
        perPage: PER_PAGE,
        ...(debounced ? { search: debounced } : {}),
        ...(level ? { level } : {}),
        ...(topic ? { topic } : {}),
        ...(partOfSpeech ? { partOfSpeech } : {}),
        ...(onlyUnseen ? { onlyUnseen: true } : {}),
      }),
    [debounced, level, topic, partOfSpeech, onlyUnseen, page],
  );

  const totalPages = words.data ? Math.max(1, Math.ceil(words.data.total / words.data.perPage)) : 1;

  return (
    <div>
      <PageHeader
        title="Словарь"
        description="Общий словарь собран из открытых источников; прогресс по каждому слову — ваш личный."
        action={
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Добавить своё слово
          </Button>
        }
      />

      {/* ─── Фильтры ─── */}
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Поиск"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="слово или перевод"
          />
          <Select
            label="Уровень"
            value={level}
            onChange={(event) => {
              setLevel(event.target.value as CefrLevel | '');
              setPage(1);
            }}
          >
            <option value="">Любой</option>
            {LEVELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select
            label="Часть речи"
            value={partOfSpeech}
            onChange={(event) => {
              setPartOfSpeech(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Любая</option>
            {meta.data?.partsOfSpeech.map((item) => (
              <option key={item.partOfSpeech} value={item.partOfSpeech}>
                {PART_OF_SPEECH_LABELS[item.partOfSpeech] ?? item.partOfSpeech} ({item.count})
              </option>
            ))}
          </Select>
          <Select
            label="Тема"
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Любая</option>
            {meta.data?.topics.map((item) => (
              <option key={item.topic} value={item.topic}>
                {item.topic} ({item.count})
              </option>
            ))}
          </Select>
        </div>

        <div className="text-soft mt-4 flex items-center justify-between gap-3 text-[13px]">
          <span>Только слова, которые я ещё не встречал</span>
          <Switch
            checked={onlyUnseen}
            aria-label="Только слова, которые я ещё не встречал"
            onChange={(value) => {
              setOnlyUnseen(value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      {words.error ? <ErrorNote message={words.error} onRetry={words.reload} /> : null}

      {words.loading && !words.data ? (
        <Loading label="Ищем слова" />
      ) : (words.data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState title="Ничего не найдено" description="Попробуйте изменить фильтры или поисковый запрос." />
        </Card>
      ) : (
        <>
          <p className="text-faint mb-3 text-[13px]">
            Найдено {formatNumber(words.data?.total ?? 0)} · страница {page} из {totalPages}
          </p>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {words.data?.items.map((word) => (
              <WordCard key={word.id} word={word} onOpen={() => setOpenId(word.id)} />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-center gap-2">
            <Button size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
              Назад
            </Button>
            <span className="text-soft px-2 text-[13px] tabular-nums">
              {page} / {totalPages}
            </span>
            <Button size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
              Дальше
            </Button>
          </div>
        </>
      )}

      {openId !== null ? (
        <WordModal
          id={openId}
          aiEnabled={health.data?.aiEnabled ?? false}
          onClose={() => setOpenId(null)}
          onChanged={words.reload}
        />
      ) : null}

      <AddWordModal open={adding} onClose={() => setAdding(false)} onAdded={words.reload} />
    </div>
  );
}

function WordCard({ word, onOpen }: { word: DictionaryWord; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-line bg-raised hover:border-line-strong rounded-2xl border p-4 text-left transition-colors duration-150"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="word-display text-ink truncate text-[19px] font-medium">{word.text}</p>
          {word.transcription ? <p className="text-faint mt-0.5 text-[12px]">{word.transcription}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge>{word.level}</Badge>
          {word.progress ? (
            <Badge tone={STATUS_TONE[word.progress.status]}>{WORD_STATUS_LABELS[word.progress.status]}</Badge>
          ) : null}
        </div>
      </div>

      <p className="text-soft mt-2 line-clamp-2 text-[13px]">{word.translations.join(', ')}</p>

      {word.progress ? (
        <div className="bg-sunken mt-3 h-1 overflow-hidden rounded-full">
          <div className="bg-accent h-full rounded-full" style={{ width: `${word.progress.strength * 100}%` }} />
        </div>
      ) : null}
    </button>
  );
}

// ─────────────────────────────── Карточка слова ───────────────────────────────

function WordModal({
  id,
  aiEnabled,
  onClose,
  onChanged,
}: {
  id: number;
  aiEnabled: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useAsync(() => api.words.detail(id), [id]);
  const notify = useUi((state) => state.notify);
  const [enriching, setEnriching] = useState(false);
  const [diving, setDiving] = useState(false);
  const [dive, setDive] = useState<string | null>(null);

  const word = detail.data?.word;
  const progress = detail.data?.progress ?? null;

  const enrich = async () => {
    setEnriching(true);
    try {
      await api.words.enrich(id);
      detail.reload();
    } catch (cause) {
      notify({ title: cause instanceof ApiError ? cause.message : 'Не удалось дополнить', tone: 'danger' });
    } finally {
      setEnriching(false);
    }
  };

  const deepDive = async () => {
    setDiving(true);
    try {
      const { task } = await api.ai.createTask({ type: 'word_deep_dive', wordId: id });
      setDive(
        [
          task.payload.summary,
          ...(task.payload.senses ?? []).map((sense) => `• ${sense.meaning}\n  ${sense.example}\n  ${sense.exampleRu}`),
          task.payload.collocations?.length ? `Сочетания: ${task.payload.collocations.join(', ')}` : '',
          task.payload.confusedWith?.length ? `Не путать: ${task.payload.confusedWith.join('; ')}` : '',
          task.payload.mnemonic ? `Как запомнить: ${task.payload.mnemonic}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
    } catch (cause) {
      notify({ title: cause instanceof ApiError ? cause.message : 'Разбор недоступен', tone: 'danger' });
    } finally {
      setDiving(false);
    }
  };

  const toggleFavorite = async () => {
    if (!progress && !word) return;
    await api.words.setFlags(id, { isFavorite: !(progress?.isFavorite ?? false) });
    detail.reload();
    onChanged();
  };

  const toggleIgnored = async () => {
    await api.words.setFlags(id, { isIgnored: !(progress?.isIgnored ?? false) });
    detail.reload();
    onChanged();
  };

  const reset = async () => {
    await api.words.reset(id);
    notify({ title: 'Прогресс по слову сброшен', tone: 'neutral' });
    detail.reload();
    onChanged();
  };

  return (
    <Modal open onClose={onClose} wide>
      {detail.loading && !detail.data ? (
        <Loading label="" />
      ) : detail.error ? (
        <ErrorNote message={detail.error} onRetry={detail.reload} />
      ) : word ? (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <p className="word-display text-ink text-[34px] leading-tight font-semibold tracking-tight">
                  {word.text}
                </p>
                <DislikeButton
                  wordId={id}
                  level={progress?.dislikeLevel ?? 0}
                  onChange={() => {
                    detail.reload();
                    onChanged();
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                {word.transcription ? <span className="text-faint text-[14px]">{word.transcription}</span> : null}
                <button
                  type="button"
                  onClick={() => playPronunciation(word.text, word.audioUrl)}
                  className="text-faint hover:text-ink text-[13px] transition-colors"
                >
                  Прослушать
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge>{word.level}</Badge>
              {word.partOfSpeech ? (
                <Badge>{PART_OF_SPEECH_LABELS[word.partOfSpeech] ?? word.partOfSpeech}</Badge>
              ) : null}
              {word.topic ? <Badge>{word.topic}</Badge> : null}
              {word.frequencyRank ? <Badge tone="accent">#{word.frequencyRank} по частоте</Badge> : null}
            </div>
          </div>

          <p className="text-ink mt-4 text-[15px]">{word.translations.join(', ')}</p>
          {word.gloss ? <p className="text-soft mt-1.5 text-[13px] italic">{word.gloss}</p> : null}
          {word.examples.length > 0 ? (
            <div className="border-line mt-5 border-t pt-4">
              <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Примеры</p>
              <ul className="space-y-2.5">
                {word.examples.map((example) => (
                  <li key={example.text}>
                    <div className="flex items-start gap-1.5">
                      <p className="text-soft flex-1 text-[13px] leading-snug">
                        {splitAroundWord(example.text, word.text).map((part, index) =>
                          part.match ? (
                            <span key={index} className="text-ink font-semibold">
                              {part.text}
                            </span>
                          ) : (
                            <span key={index}>{part.text}</span>
                          ),
                        )}
                      </p>
                      {isAiGeneratedExample(example.source) ? (
                        <span className="mt-0.5">
                          <AiExampleIndicator />
                        </span>
                      ) : null}
                    </div>
                    {example.translation ? (
                      <p className="text-faint mt-0.5 text-[13px]">{example.translation}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {word.senses.length > 0 ? (
            <div className="border-line mt-5 border-t pt-4">
              <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Значения</p>
              <ul className="space-y-2">
                {word.senses.map((sense) => (
                  <li key={sense.sense} className="text-[13px]">
                    <span className="text-soft italic">{sense.sense}</span>
                    <span className="text-ink"> — {sense.translations.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ─── Личная статистика ─── */}
          {progress ? (
            <div className="border-line mt-5 border-t pt-4">
              <p className="text-faint mb-3 text-[12px] font-medium tracking-wide uppercase">Ваш прогресс</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
                <Field label="Статус" value={WORD_STATUS_LABELS[progress.status] ?? progress.status} />
                <Field label="Сила" value={formatPercent(progress.strength)} />
                <Field label="Показов" value={String(progress.timesSeen)} />
                <Field label="Точность" value={formatPercent(progress.accuracy)} />
                <Field label="Серия" value={`${progress.currentStreak} (макс. ${progress.bestStreak})`} />
                <Field label="Интервал" value={`${progress.intervalDays} дн.`} />
                <Field label="Повтор" value={formatRelative(progress.dueAt)} />
                <Field label="Ср. ответ" value={formatResponseTime(progress.avgResponseMs)} />
              </div>
            </div>
          ) : (
            <p className="text-faint border-line mt-5 border-t pt-4 text-[13px]">
              Это слово вам ещё не попадалось.
            </p>
          )}

          {/* ─── Последние ответы ─── */}
          {(detail.data?.recentAttempts.length ?? 0) > 0 ? (
            <div className="border-line mt-5 border-t pt-4">
              <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Последние ответы</p>
              <ul className="space-y-1.5">
                {detail.data?.recentAttempts.map((attempt, index) => (
                  <li key={`${attempt.createdAt}-${index}`} className="flex items-center gap-3 text-[13px]">
                    <span className={cx('w-3 shrink-0', attempt.isCorrect ? 'text-success' : 'text-danger')}>
                      {attempt.isCorrect ? '✓' : '✕'}
                    </span>
                    <span className="text-ink min-w-0 flex-1 truncate">{attempt.given || '—'}</span>
                    <span className="text-faint shrink-0 text-[12px]">{formatResponseTime(attempt.responseMs)}</span>
                    <span className="text-faint hidden shrink-0 text-[12px] sm:inline">
                      {formatDateTime(attempt.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {dive ? (
            <div className="bg-sunken mt-5 rounded-xl p-4">
              <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Разбор от ИИ</p>
              <p className="text-ink text-[13px] leading-relaxed whitespace-pre-line">{dive}</p>
            </div>
          ) : null}

          <div className="border-line mt-5 flex flex-wrap gap-2 border-t pt-4">
            <Button size="sm" onClick={toggleFavorite}>
              {progress?.isFavorite ? 'Убрать из избранного' : 'В избранное'}
            </Button>
            <Button size="sm" onClick={toggleIgnored}>
              {progress?.isIgnored ? 'Вернуть в оборот' : 'Не показывать'}
            </Button>
            {!word.enriched ? (
              <Button size="sm" loading={enriching} onClick={enrich}>
                Дополнить из словаря
              </Button>
            ) : null}
            {aiEnabled ? (
              <Button size="sm" loading={diving} onClick={deepDive}>
                Разбор от ИИ
              </Button>
            ) : null}
            {progress ? (
              <Button size="sm" variant="ghost" onClick={reset}>
                Сбросить прогресс
              </Button>
            ) : null}
          </div>

          {word.license ? <p className="text-faint mt-4 text-[11px]">Источник данных: {word.license}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-faint text-[12px]">{label}</p>
      <p className="text-ink mt-0.5 text-[13px] font-medium tabular-nums">{value}</p>
    </div>
  );
}

// ─────────────────────────────── Своё слово ───────────────────────────────

function AddWordModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const notify = useUi((state) => state.notify);
  const [text, setText] = useState('');
  const [translations, setTranslations] = useState('');
  const [level, setLevel] = useState<CefrLevel>('B1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () =>
      translations
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    [translations],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.words.addCustom({ text: text.trim(), translations: parsed, level });
      notify({ title: 'Слово добавлено', description: 'Оно будет попадаться в тренировках', tone: 'success' });
      setText('');
      setTranslations('');
      onAdded();
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось добавить слово');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Своё слово">
      <div className="space-y-4">
        <Input
          label="Слово по-английски"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="serendipity"
        />
        <Textarea
          label="Переводы"
          rows={3}
          value={translations}
          onChange={(event) => setTranslations(event.target.value)}
          placeholder="счастливая случайность, интуитивная прозорливость"
          hint="Через запятую или с новой строки — любой из них будет считаться верным"
        />
        <Select label="Уровень" value={level} onChange={(event) => setLevel(event.target.value as CefrLevel)}>
          {LEVELS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>

        {error ? <ErrorNote message={error} /> : null}

        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={saving}
            disabled={!text.trim() || parsed.length === 0}
            onClick={save}
          >
            Добавить
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  );
}
