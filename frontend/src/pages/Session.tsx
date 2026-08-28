import { ArrowLeft, CircleHelp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AiExampleIndicator, isAiGeneratedExample } from '../components/AiExampleIndicator';
import { DislikeButton } from '../components/DislikeButton';
import { Badge, Button, Card, ErrorNote, Kbd, LinkButton, Loading, Progress, Stat, cx } from '../components/ui';
import { ApiError, api } from '../lib/api';
import {
  MATCH_TYPE_LABELS,
  MODE_LABELS,
  PART_OF_SPEECH_LABELS,
  formatDuration,
  formatNumber,
  formatPercent,
  plural,
  pointsWord,
  splitAroundWord,
} from '../lib/format';
import { speak, speechSupported, stopSpeaking } from '../lib/speech';
import type { AnswerResult, PoolState, Question } from '../lib/types';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

export function Session() {
  const { poolId } = useParams<{ poolId: string }>();
  const navigate = useNavigate();
  const user = useAuth((state) => state.user);
  const patchUser = useAuth((state) => state.patchUser);
  const notify = useUi((state) => state.notify);

  const [state, setState] = useState<PoolState | null>(null);
  // Ответ сервера содержит уже следующий вопрос, поэтому применяем его
  // только после закрытия разбора — иначе слово было бы видно заранее.
  const [pending, setPending] = useState<PoolState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState<AnswerResult['poolSummary'] | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const askedAt = useRef(Date.now());

  const question = state?.question ?? null;
  const phase: 'question' | 'feedback' = result ? 'feedback' : 'question';

  // ─── Загрузка пулла ───
  useEffect(() => {
    if (!poolId) return;
    let alive = true;
    api.practice
      .pool(poolId)
      .then((loaded) => {
        if (alive) setState(loaded);
      })
      .catch((cause: unknown) => {
        if (alive) setLoadError(cause instanceof ApiError ? cause.message : 'Пулл не найден');
      });
    return () => {
      alive = false;
    };
  }, [poolId]);

  // ─── Новый вопрос: сброс ввода, отсчёт времени, озвучка на слух ───
  useEffect(() => {
    if (!question || phase === 'feedback') return;
    askedAt.current = Date.now();
    setAnswer('');
    inputRef.current?.focus();
    if (question.direction === 'audio_en' && user?.soundEnabled !== false) {
      speak(question.prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.wordId, question?.isRetry, phase]);

  useEffect(() => stopSpeaking, []);

  const advance = useCallback(() => {
    setPending((next) => {
      if (next) setState(next);
      return null;
    });
    setResult(null);
    // Фокус возвращается после перерисовки поля.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const applyDislike = useCallback((wordId: number, level: number) => {
    setState((current) => {
      if (!current?.question || current.question.wordId !== wordId) return current;
      return { ...current, question: { ...current.question, dislikeLevel: level } };
    });
    setPending((current) => {
      if (!current?.question || current.question.wordId !== wordId) return current;
      return { ...current, question: { ...current.question, dislikeLevel: level } };
    });
    setResult((current) => {
      if (!current || current.word.id !== wordId) return current;
      return { ...current, wordProgress: { ...current.wordProgress, dislikeLevel: level } };
    });
  }, []);

  const submit = useCallback(
    async (given: string, options?: { gaveUp?: boolean }) => {
      if (!poolId || !question || sending) return;
      const trimmed = given.trim();
      if (!options?.gaveUp && !trimmed) return;

      setSending(true);
      try {
        const response = await api.practice.answer(poolId, {
          wordId: question.wordId,
          answer: trimmed,
          responseMs: Math.min(600_000, Date.now() - askedAt.current),
          hintsUsed: 0,
          ...(options?.gaveUp ? { gaveUp: true } : {}),
        });

        setPending(response.state);
        setResult({
          ...response.result,
          wordProgress: {
            ...response.result.wordProgress,
            dislikeLevel: Math.max(
              response.result.wordProgress.dislikeLevel ?? 0,
              question.dislikeLevel ?? 0,
            ),
          },
        });

        const { rating } = response.result;
        patchUser({ points: rating.points, level: rating.level, progress: rating.progress });

        if (rating.leveledUp) {
          notify({
            title: `Уровень ${rating.level}`,
            description:
              rating.freezesGranted > 0
                ? `Выдана заморозка серии: ${rating.freezesGranted}`
                : 'Посмотрите, что открылось в разделе «Награды»',
            tone: 'reward',
          });
        }
        for (const achievement of response.result.achievements) {
          notify({ title: achievement.title, description: achievement.description, tone: 'reward' });
        }
        if (response.result.dailyGoal.justCompleted) {
          notify({ title: 'Дневная цель выполнена', tone: 'success' });
        }
        if (response.result.poolCompleted) {
          setFinished(response.result.poolSummary ?? null);
        }
      } catch (cause) {
        notify({
          title: cause instanceof ApiError ? cause.message : 'Ответ не отправлен',
          tone: 'danger',
        });
      } finally {
        setSending(false);
      }
    },
    [poolId, question, sending, patchUser, notify],
  );

  // ─── Клавиатура ───
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (phase === 'question' && event.key === 'Escape') {
        if (event.repeat) return;
        event.preventDefault();
        void submit(answer, { gaveUp: true });
        return;
      }
      if (phase === 'feedback') {
        // Разбор держим на экране, пока пользователь сам не нажмёт клавишу.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape'].includes(event.key)) return;
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest('[data-dislike-button]') &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          return;
        }
        event.preventDefault();
        advance();
        return;
      }
      if (phase === 'question' && question?.choices && /^[1-4]$/.test(event.key)) {
        const choice = question.choices[Number(event.key) - 1];
        if (choice) {
          event.preventDefault();
          void submit(choice);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, question, answer, advance, submit]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <ErrorNote message={loadError} />
        <div className="mt-4 flex justify-center">
          <LinkButton to="/practice" variant="secondary">
            К выбору режима
          </LinkButton>
        </div>
      </div>
    );
  }

  if (!state) return <Loading label="Открываем пулл" />;

  // Итоги показываем только после того, как пользователь закрыл разбор
  // последнего ответа, — иначе он бы его не увидел.
  if (!result && (finished || (!question && state.pool.status !== 'active'))) {
    return <Summary state={pending ?? state} summary={finished} />;
  }

  if (!question) return <Loading label="Подбираем слово" />;

  const shown = pending ?? state;
  const solved = shown.progress.solved;
  const total = shown.progress.total;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ─── Тонкая полоса прогресса вместо навигации ─── */}
      <header className="border-line bg-surface/85 sticky top-0 z-20 border-b backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-4 px-4">
          <button
            type="button"
            onClick={() => navigate('/practice')}
            className="text-faint hover:text-ink inline-flex items-center gap-1 text-[13px] transition-colors"
          >
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            Выйти
          </button>
          <div className="flex-1">
            <Progress value={solved / Math.max(1, total)} tone="ink" />
          </div>
          <span className="text-soft text-[13px] font-medium tabular-nums">
            {solved}/{total}
          </span>
          <span className="text-faint hidden text-[13px] tabular-nums sm:inline" title="Очки рейтинга">
            {formatNumber(user?.points ?? 0)}
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10">
        <div className="mb-6 flex items-center gap-2">
          <Badge>{MODE_LABELS[state.pool.mode]}</Badge>
          <Badge>{question.level}</Badge>
          {question.partOfSpeech ? (
            <Badge>{PART_OF_SPEECH_LABELS[question.partOfSpeech] ?? question.partOfSpeech}</Badge>
          ) : null}
          {question.isRetry ? <Badge tone="warning">повтор в пулле</Badge> : null}
          {result?.sessionStreak && result.sessionStreak > 2 ? (
            <Badge tone="success">серия {result.sessionStreak}</Badge>
          ) : null}
        </div>

        <Prompt
          question={question}
          showDislike={phase === 'question' && question.direction !== 'audio_en'}
          onDislike={(level) => applyDislike(question.wordId, level)}
        />

        {phase === 'question' ? (
          <QuestionForm
            question={question}
            answer={answer}
            setAnswer={setAnswer}
            onSubmit={(value) => void submit(value ?? answer)}
            onGiveUp={() => void submit(answer, { gaveUp: true })}
            sending={sending}
            inputRef={inputRef}
          />
        ) : result ? (
          <Feedback
            result={result}
            question={question}
            onNext={advance}
            onDislike={(level) => applyDislike(result.word.id, level)}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────── Вопрос ───────────────────────────────

function Prompt({
  question,
  showDislike,
  onDislike,
}: {
  question: Question;
  showDislike: boolean;
  onDislike: (level: number) => void;
}) {
  const isAudio = question.direction === 'audio_en';

  return (
    <div className="mb-8">
      {isAudio ? (
        <div className="flex flex-col items-start gap-3">
          <button
            type="button"
            onClick={() => speak(question.prompt)}
            className="border-line hover:border-line-strong bg-raised flex h-16 w-16 items-center justify-center rounded-2xl border transition-colors"
            aria-label="Прослушать слово"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 9v6h3l5 4V5L7 9H4Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <p className="text-faint text-[13px]">Нажмите, чтобы прослушать ещё раз</p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2.5">
            <p className="word-display text-ink min-w-0 text-[44px] leading-tight font-semibold tracking-tight sm:text-[56px]">
              {question.prompt}
            </p>
            {showDislike ? (
              <DislikeButton
                wordId={question.wordId}
                level={question.dislikeLevel ?? 0}
                onChange={onDislike}
                className="mt-2.5 sm:mt-3.5"
              />
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-3">
            {question.transcription ? <p className="text-faint text-[15px]">{question.transcription}</p> : null}
            {question.direction === 'en_ru' && speechSupported() ? (
              <button
                type="button"
                onClick={() => speak(question.prompt)}
                className="text-faint hover:text-ink text-[13px] transition-colors"
              >
                Прослушать
              </button>
            ) : null}
          </div>
        </>
      )}

      <p className="text-soft mt-4 text-[13px]">
        {question.choices && question.choices.length > 0 ? (
          question.direction === 'ru_en' ? (
            'Выберите английское слово'
          ) : (
            'Выберите перевод'
          )
        ) : (
          <>
            {question.direction === 'ru_en' ? 'Напишите слово по-английски' : 'Напишите перевод на русский'}
            {question.answerLength > 0 ? ` · ${plural(question.answerLength, 'буква', 'буквы', 'букв')}` : ''}
          </>
        )}
      </p>
    </div>
  );
}

function QuestionForm({
  question,
  answer,
  setAnswer,
  onSubmit,
  onGiveUp,
  sending,
  inputRef,
}: {
  question: Question;
  answer: string;
  setAnswer: (value: string) => void;
  onSubmit: (value?: string) => void;
  onGiveUp: () => void;
  sending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const choices = question.choices;

  return (
    <div>
      {choices && choices.length > 0 ? (
        <div className="space-y-4">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {choices.map((choice, index) => (
              <button
                key={choice}
                type="button"
                disabled={sending}
                onClick={() => onSubmit(choice)}
                className="border-line bg-raised hover:border-line-strong flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm transition-colors duration-150 disabled:opacity-50"
              >
                <Kbd>{index + 1}</Kbd>
                <span className="text-ink">{choice}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="md" disabled={sending} onClick={onGiveUp}>
              <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" />
              Не знаю
            </Button>
            <span className="text-faint text-[12px]">
              <Kbd>Esc</Kbd>
            </span>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex gap-2.5">
            <input
              ref={inputRef}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              lang={question.direction === 'ru_en' ? 'en' : 'ru'}
              placeholder={question.direction === 'ru_en' ? 'english word' : 'перевод'}
              className="border-line bg-raised text-ink placeholder:text-faint focus:border-ink h-14 flex-1 rounded-xl border px-4 text-[17px] transition-colors outline-none"
            />
            <Button type="submit" variant="primary" size="lg" loading={sending} disabled={!answer.trim()}>
              Ответить
            </Button>
          </div>
        </form>
      )}

      {!choices || choices.length === 0 ? (
        <div className="mt-4 flex items-center gap-3">
          <Button variant="ghost" size="md" disabled={sending} onClick={onGiveUp}>
            <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" />
            Не знаю
          </Button>
          <span className="text-faint text-[12px]">
            <Kbd>Esc</Kbd>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────── Разбор ответа ───────────────────────────────

function Feedback({
  result,
  question,
  onNext,
  onDislike,
}: {
  result: AnswerResult;
  question: Question;
  onNext: () => void;
  onDislike: (level: number) => void;
}) {
  const correct = result.isCorrect;
  // При успехе в заголовке — тот перевод, который засчитали, а не всегда первый из словаря.
  const shownAnswer = correct && result.matched ? result.matched : result.correctAnswer;
  const heading =
    question.direction === 'ru_en'
      ? `${question.prompt} — ${shownAnswer}`
      : `${result.word.text} — ${shownAnswer}`;
  const alsoFits = result.allAnswers.filter((item) => item !== shownAnswer);

  return (
    <div>
      <div
        className={cx(
          'animate-rise rounded-2xl border p-5',
          correct ? 'border-success/30 bg-success-soft' : 'border-danger/30 bg-danger-soft',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={cx('text-sm font-semibold', correct ? 'text-success' : 'text-danger')}>
              {correct
                ? result.matchType === 'exact'
                  ? 'Верно'
                  : `Верно (${MATCH_TYPE_LABELS[result.matchType]})`
                : result.matchType === 'skipped'
                  ? 'Не знаю'
                  : 'Неверно'}
            </p>
            <div className="mt-2 flex items-start gap-2">
              <p className="word-display text-ink min-w-0 text-[26px] leading-tight font-semibold">{heading}</p>
              <DislikeButton
                wordId={result.word.id}
                level={result.wordProgress.dislikeLevel ?? 0}
                onChange={onDislike}
                size="sm"
                className="mt-0.5"
              />
            </div>
            {alsoFits.length > 0 ? (
              <p className="text-soft mt-1.5 text-[13px]">
                Также подходит: {alsoFits.join(', ')}
              </p>
            ) : null}
            {result.word.gloss ? <p className="text-faint mt-2 text-[13px] italic">{result.word.gloss}</p> : null}
          </div>

          {result.reward.points > 0 ? (
            <div className="text-right">
              <p className="text-ink text-[22px] font-semibold tabular-nums">+{result.reward.points}</p>
              <p className="text-faint text-[12px]">{pointsWord(result.reward.points)} рейтинга</p>
              <p className="text-faint mt-1 text-[12px] tabular-nums">
                {result.rating.progress.isMax
                  ? `ур. ${result.rating.level} · максимум`
                  : `ур. ${result.rating.level} · ${formatNumber(result.rating.progress.pointsToNext)} до следующего`}
              </p>
            </div>
          ) : null}
        </div>

        {result.reward.breakdown.length > 0 ? (
          <ul className="border-line/60 mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
            {result.reward.breakdown.map((item) => (
              <li key={item.label} className="text-soft text-[12px]">
                {item.label} <span className="text-ink font-medium">{item.value}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {!correct ? (
          <p className="text-soft mt-4 text-[13px]">Слово останется в пулле и вернётся ещё раз.</p>
        ) : null}
      </div>

      <Examples word={result.word} />

      <div className="mt-6 flex items-center gap-4">
        <Button variant="primary" size="lg" onClick={onNext} autoFocus>
          Дальше
        </Button>
        <span className="text-faint text-[12px]">
          <Kbd>Enter</Kbd> или любая клавиша — продолжить
        </span>
        <span className="text-faint ml-auto text-[12px]">
          сила слова {formatPercent(result.wordProgress.strength)}
        </span>
      </div>
    </div>
  );
}

/**
 * Примеры употребления слова. Обычно они приходят вместе с разбором ответа,
 * потому что готовятся фоном ещё при сборке пулла; если до слова очередь не
 * дошла, дозапрашиваем их отдельно. Когда примеров нет вовсе, показываем
 * старый разбор по значениям — пустой карточке тут не место.
 */
function Examples({ word }: { word: AnswerResult['word'] }) {
  const [examples, setExamples] = useState(word.examples);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setExamples(word.examples);
    if (word.examples.length > 0) return;

    let alive = true;
    setLoading(true);
    api.words
      .examples(word.id)
      .then((response) => {
        if (alive) setExamples(response.examples);
      })
      .catch(() => {
        // Примеров не нашлось — ниже покажутся значения слова.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [word.id, word.examples]);

  if (examples.length === 0) {
    if (loading) {
      return (
        <Card className="mt-4">
          <p className="text-faint text-[12px] font-medium tracking-wide uppercase">Примеры</p>
          <p className="text-faint mt-2.5 text-[13px]">Подбираем примеры…</p>
        </Card>
      );
    }
    return <Senses senses={word.senses} />;
  }

  return (
    <Card className="mt-4">
      <p className="text-faint mb-3 text-[12px] font-medium tracking-wide uppercase">Примеры</p>
      <ul className="space-y-3.5">
        {examples.map((example) => (
          <li key={example.text}>
            <div className="flex items-start gap-2.5">
              <p className="text-soft flex-1 text-[14px] leading-snug">
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
              <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                {isAiGeneratedExample(example.source) ? <AiExampleIndicator /> : null}
                {speechSupported() ? (
                  <button
                    type="button"
                    onClick={() => speak(example.text)}
                    className="text-faint hover:text-ink transition-colors"
                    aria-label="Прослушать пример"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 9v6h3l5 4V5L7 9H4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      <path d="M16 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
            {example.translation ? <p className="text-faint mt-1 text-[13px]">{example.translation}</p> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Senses({ senses }: { senses: AnswerResult['word']['senses'] }) {
  if (senses.length === 0) return null;

  return (
    <Card className="mt-4">
      <p className="text-faint mb-2.5 text-[12px] font-medium tracking-wide uppercase">Значения</p>
      <ul className="space-y-2">
        {senses.slice(0, 4).map((sense) => (
          <li key={sense.sense} className="text-[13px]">
            <span className="text-soft italic">{sense.sense}</span>
            <span className="text-ink"> — {sense.translations.join(', ')}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─────────────────────────────── Итоги пулла ───────────────────────────────

function Summary({ state, summary }: { state: PoolState; summary: AnswerResult['poolSummary'] | null }) {
  const pool = state.pool;
  const accuracy = useMemo(() => {
    if (summary) return summary.accuracy;
    const total = pool.correctCount + pool.wrongCount;
    return total > 0 ? pool.correctCount / total : null;
  }, [summary, pool]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16">
      <p className="text-faint text-[13px]">
        {MODE_LABELS[pool.mode]} · пулл №{pool.ordinal}
      </p>
      <h1 className="text-ink mt-1 text-3xl font-semibold tracking-tight">Пулл закрыт</h1>
      <p className="text-soft mt-2 text-sm">
        {pool.wrongCount === 0
          ? 'Ни одной ошибки — все слова с первого раза.'
          : `Слова, которые не поддались сразу, вернутся в следующих пуллах.`}
      </p>

      <Card className="mt-7">
        <div className="grid grid-cols-2 gap-5">
          <Stat label="Слов в пулле" value={formatNumber(summary?.size ?? pool.size)} />
          <Stat label="Точность" value={formatPercent(accuracy, 0)} tone={pool.wrongCount === 0 ? 'success' : undefined} />
          <Stat label="Ошибок" value={formatNumber(summary?.wrong ?? pool.wrongCount)} tone={pool.wrongCount > 0 ? 'danger' : undefined} />
          <Stat label="Время" value={summary ? formatDuration(summary.durationMs) : '—'} />
          <Stat label="Очки рейтинга" value={`+${formatNumber(summary?.points ?? pool.pointsEarned)}`} tone="accent" />
        </div>
      </Card>

      <div className="mt-6 flex flex-wrap gap-2.5">
        <LinkButton to="/practice" variant="primary" size="lg">
          Следующий пулл
        </LinkButton>
        <LinkButton to="/stats" variant="secondary" size="lg">
          Статистика
        </LinkButton>
        <LinkButton to="/" variant="ghost" size="lg">
          На обзор
        </LinkButton>
      </div>
    </div>
  );
}
