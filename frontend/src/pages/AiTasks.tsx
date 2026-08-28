import { useEffect, useRef, useState } from 'react';
import { Ring } from '../components/charts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
  cx,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDateTime, formatPoints, plural } from '../lib/format';
import { speak } from '../lib/speech';
import type { AiResult, AiTask, AiTaskType, CefrLevel } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Разбор слова запускается из словаря — здесь его выбрать нельзя. */
const SELECTABLE = (type: AiTaskType): boolean => type !== 'word_deep_dive';

export function AiTasks() {
  const user = useAuth((state) => state.user);
  const patchUser = useAuth((state) => state.patchUser);
  const notify = useUi((state) => state.notify);

  const meta = useAsync(() => api.ai.meta(), []);
  const history = useAsync(() => api.ai.history(20), []);

  const [type, setType] = useState<AiTaskType>('sentence_ru_en');
  const [level, setLevel] = useState<CefrLevel | ''>('');
  const [topic, setTopic] = useState('');

  const [task, setTask] = useState<AiTask | null>(null);
  const [generating, setGenerating] = useState(false);
  const [answer, setAnswer] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Текст диктанта приходит отдельным запросом, чтобы его нельзя было прочитать.
  const listeningText = useRef<string | null>(null);

  useEffect(() => {
    if (!task || task.type !== 'listening') return;
    let alive = true;
    api.ai
      .audioText(task.id)
      .then(({ text }) => {
        if (!alive) return;
        listeningText.current = text;
        speak(text, { rate: 0.85 });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [task]);

  if (meta.loading && !meta.data) return <Loading label="Готовим задания" />;
  if (meta.error) return <ErrorNote message={meta.error} onRetry={meta.reload} />;
  if (!meta.data) return null;

  if (!meta.data.enabled) {
    return (
      <div>
        <PageHeader title="Задания ИИ" />
        <Card>
          <EmptyState
            title="Модуль ИИ выключен"
            description="Добавьте OPENAI_API_KEY в backend/.env и перезапустите сервер — задания, проверка ответов и диалог с репетитором заработают."
          />
        </Card>
      </div>
    );
  }

  const generate = async () => {
    setGenerating(true);
    setFailure(null);
    setResult(null);
    setAnswer('');
    listeningText.current = null;
    try {
      const response = await api.ai.createTask({
        type,
        ...(level ? { level } : {}),
        ...(topic.trim() ? { topic: topic.trim() } : {}),
      });
      setTask(response.task);
    } catch (cause) {
      setFailure(cause instanceof ApiError ? cause.message : 'Не удалось создать задание');
    } finally {
      setGenerating(false);
    }
  };

  const check = async (given: string) => {
    if (!task || !given.trim()) return;
    setChecking(true);
    setFailure(null);
    try {
      const response = await api.ai.submit(task.id, given);
      setResult(response.result);
      patchUser({
        points: response.result.rating.points,
        level: response.result.rating.level,
        progress: response.result.rating.progress,
      });
      if (response.result.rating.leveledUp) {
        notify({ title: `Уровень ${response.result.rating.level}`, tone: 'reward' });
      }
      for (const achievement of response.result.achievements) {
        notify({ title: achievement.title, description: achievement.description, tone: 'reward' });
      }
      history.reload();
    } catch (cause) {
      setFailure(cause instanceof ApiError ? cause.message : 'Проверка не удалась');
    } finally {
      setChecking(false);
    }
  };

  const selectedType = meta.data.types.find((item) => item.type === type);

  return (
    <div>
      <PageHeader
        title="Задания ИИ"
        description={`Проверяет и объясняет ошибки модель ${meta.data.model ?? ''}. Задания подстраиваются под ваши слабые слова.`}
      />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* ─── Настройка задания ─── */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <SectionTitle title="Тип задания" />
            <div className="space-y-1.5">
              {meta.data.types.filter((item) => SELECTABLE(item.type)).map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setType(item.type)}
                  className={cx(
                    'w-full rounded-xl border px-3 py-2.5 text-left transition-colors duration-150',
                    type === item.type ? 'border-ink' : 'border-transparent hover:bg-sunken',
                  )}
                >
                  <span className="text-ink text-[13px] font-medium">{item.label}</span>
                </button>
              ))}
            </div>

            {selectedType ? (
              <p className="text-soft border-line mt-4 border-t pt-4 text-[13px] leading-relaxed">
                {selectedType.description}
              </p>
            ) : null}

            <div className="mt-4 space-y-3">
              <Select
                label="Уровень"
                value={level}
                onChange={(event) => setLevel(event.target.value as CefrLevel | '')}
              >
                <option value="">Мой ({user?.cefrLevel})</option>
                {LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>

              {type === 'grammar_quiz' ? (
                <Select label="Тема" value={topic} onChange={(event) => setTopic(event.target.value)}>
                  <option value="">Случайная</option>
                  {(meta.data.grammarTopics[level || (user?.cefrLevel ?? 'B1')] ?? []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              ) : (
                <label className="block">
                  <span className="text-soft mb-1.5 block text-[13px] font-medium">Тема (необязательно)</span>
                  <input
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    placeholder="работа, путешествия, кино…"
                    className="border-line bg-raised text-ink placeholder:text-faint focus:border-accent w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors outline-none"
                  />
                </label>
              )}
            </div>

            <Button variant="primary" block className="mt-4" loading={generating} onClick={generate}>
              {task ? 'Новое задание' : 'Сгенерировать'}
            </Button>
          </Card>
        </aside>

        {/* ─── Задание и разбор ─── */}
        <section>
          {failure ? <div className="mb-4"><ErrorNote message={failure} /></div> : null}

          {!task ? (
            <Card>
              <EmptyState
                title="Выберите тип задания"
                description="Модель составит его под ваш уровень и подмешает слова, на которых вы чаще ошибаетесь."
              />
            </Card>
          ) : (
            <>
              <Card>
                <div className="mb-4 flex items-center gap-2">
                  <Badge tone="accent">{task.label}</Badge>
                  <Badge>{task.level}</Badge>
                  {task.topic ? <Badge>{task.topic}</Badge> : null}
                </div>

                <TaskBody
                  task={task}
                  answer={answer}
                  setAnswer={setAnswer}
                  disabled={checking || result !== null}
                  onChoose={(index) => void check(String(index))}
                  onReplay={() => listeningText.current && speak(listeningText.current, { rate: 0.85 })}
                />

                {task.type !== 'grammar_quiz' && task.type !== 'word_deep_dive' && !result ? (
                  <div className="mt-4 flex items-center gap-3">
                    <Button variant="primary" loading={checking} disabled={!answer.trim()} onClick={() => void check(answer)}>
                      Проверить
                    </Button>
                    {task.payload.minWords ? (
                      <span className="text-faint text-[12px] tabular-nums">
                        {answer.trim() ? answer.trim().split(/\s+/).length : 0} / {task.payload.minWords} слов
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </Card>

              {result ? <ResultPanel task={task} result={result} onNext={generate} /> : null}
            </>
          )}

          {/* ─── История ─── */}
          <div className="mt-8">
            <SectionTitle title="Выполненные задания" />
            {history.loading && !history.data ? (
              <Loading label="" />
            ) : (history.data?.items.length ?? 0) === 0 ? (
              <Card>
                <EmptyState title="Пока пусто" description="Выполненные задания появятся здесь с оценками и разбором." />
              </Card>
            ) : (
              <ul className="space-y-2">
                {history.data?.items.map((item) => (
                  <li key={item.id}>
                    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2" padded={false}>
                      <div className="flex w-full items-center gap-4 p-4">
                        <span
                          className={cx(
                            'w-11 shrink-0 text-center text-[15px] font-semibold tabular-nums',
                            item.score >= 90 ? 'text-success' : item.score >= 70 ? 'text-ink' : 'text-danger',
                          )}
                        >
                          {item.score}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-ink truncate text-[13px]">{item.answer}</p>
                          <p className="text-faint mt-0.5 text-[12px]">
                            {item.label} · {item.level} · {formatDateTime(item.createdAt)}
                          </p>
                        </div>
                        {item.points > 0 ? (
                          <span className="text-soft shrink-0 text-[13px] tabular-nums">+{item.points}</span>
                        ) : null}
                      </div>
                      {item.feedback.verdict ? (
                        <p className="text-soft border-line w-full border-t px-4 py-3 text-[13px]">
                          {item.feedback.verdict}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────── Тело задания ───────────────────────────────

function TaskBody({
  task,
  answer,
  setAnswer,
  disabled,
  onChoose,
  onReplay,
}: {
  task: AiTask;
  answer: string;
  setAnswer: (value: string) => void;
  disabled: boolean;
  onChoose: (index: number) => void;
  onReplay: () => void;
}) {
  const payload = task.payload;

  switch (task.type) {
    case 'sentence_en_ru':
    case 'sentence_ru_en':
      return (
        <>
          <p className="word-display text-ink text-[22px] leading-snug font-medium">{payload.sentence}</p>
          {payload.hint ? <p className="text-faint mt-2 text-[13px]">{payload.hint}</p> : null}
          {payload.keyWords && payload.keyWords.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {payload.keyWords.map((word) => (
                <Badge key={word}>{word}</Badge>
              ))}
            </div>
          ) : null}
          <Textarea
            className="mt-4"
            rows={3}
            value={answer}
            disabled={disabled}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={payload.direction === 'en_ru' ? 'Перевод на русский' : 'Translation into English'}
          />
        </>
      );

    case 'grammar_quiz':
      return (
        <>
          <p className="text-ink text-[17px] leading-relaxed">{payload.question}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(payload.options ?? []).map((option, index) => (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => onChoose(index)}
                className="border-line bg-raised hover:border-line-strong rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:opacity-50"
              >
                {option}
              </button>
            ))}
          </div>
        </>
      );

    case 'cloze':
      return (
        <>
          <p className="word-display text-ink text-[22px] leading-snug font-medium">{payload.sentence}</p>
          {payload.translation ? <p className="text-soft mt-2 text-[13px]">{payload.translation}</p> : null}
          <input
            value={answer}
            disabled={disabled}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="пропущенное слово"
            className="border-line bg-raised text-ink placeholder:text-faint focus:border-ink mt-4 h-12 w-full max-w-sm rounded-xl border px-4 text-[16px] transition-colors outline-none disabled:opacity-50"
          />
        </>
      );

    case 'listening':
      return (
        <>
          <button
            type="button"
            onClick={onReplay}
            className="border-line hover:border-line-strong bg-raised flex h-14 items-center gap-3 rounded-xl border px-5 text-sm transition-colors"
          >
            Прослушать ещё раз
          </button>
          <p className="text-faint mt-2 text-[13px]">
            {payload.wordCount ? `${plural(payload.wordCount, 'слово', 'слова', 'слов')} во фразе. ` : ''}
            {payload.hint ?? ''}
          </p>
          <Textarea
            className="mt-4"
            rows={2}
            value={answer}
            disabled={disabled}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Запишите фразу по-английски"
          />
        </>
      );

    case 'writing':
      return (
        <>
          <p className="text-ink text-[17px] leading-relaxed">{payload.prompt}</p>
          {payload.promptRu ? <p className="text-soft mt-1.5 text-[13px]">{payload.promptRu}</p> : null}
          {payload.checklist && payload.checklist.length > 0 ? (
            <ul className="text-soft mt-3 space-y-1 text-[13px]">
              {payload.checklist.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-faint">·</span>
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
          <Textarea
            className="mt-4"
            rows={9}
            value={answer}
            disabled={disabled}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Your text…"
          />
        </>
      );

    case 'word_deep_dive':
      return (
        <>
          <p className="word-display text-ink text-[32px] font-semibold tracking-tight">{payload.word}</p>
          {payload.summary ? <p className="text-soft mt-2 text-sm leading-relaxed">{payload.summary}</p> : null}

          {payload.senses && payload.senses.length > 0 ? (
            <ul className="border-line mt-4 space-y-3 border-t pt-4">
              {payload.senses.map((sense) => (
                <li key={sense.meaning}>
                  <p className="text-ink text-[13px] font-medium">{sense.meaning}</p>
                  <p className="text-soft mt-0.5 text-[13px] italic">{sense.example}</p>
                  <p className="text-faint text-[13px]">{sense.exampleRu}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {payload.collocations && payload.collocations.length > 0 ? (
            <div className="border-line mt-4 border-t pt-4">
              <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Сочетания</p>
              <div className="flex flex-wrap gap-1.5">
                {payload.collocations.map((item) => (
                  <Badge key={item}>{item}</Badge>
                ))}
              </div>
            </div>
          ) : null}

          {payload.confusedWith && payload.confusedWith.length > 0 ? (
            <div className="border-line mt-4 border-t pt-4">
              <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Не путать с</p>
              <ul className="text-soft space-y-1 text-[13px]">
                {payload.confusedWith.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload.mnemonic ? (
            <p className="bg-sunken text-soft mt-4 rounded-xl p-3.5 text-[13px] leading-relaxed">{payload.mnemonic}</p>
          ) : null}
        </>
      );
  }
}

// ─────────────────────────────── Разбор ───────────────────────────────

function ResultPanel({ task, result, onNext }: { task: AiTask; result: AiResult; onNext: () => void }) {
  const reference = result.reference as {
    explanation?: string;
    referenceTranslation?: string;
    answer?: string;
    translation?: string;
    hint?: string;
    correctIndex?: number;
    options?: string[];
  };

  return (
    <Card className="animate-rise mt-4">
      <div className="flex items-start gap-5">
        <Ring value={result.score / 100} tone={result.score >= 70 ? 'success' : 'danger'} size={74}>
          <span className="text-[15px] font-semibold tabular-nums">{result.score}</span>
        </Ring>

        <div className="min-w-0 flex-1">
          <p className={cx('text-sm font-medium', result.isCorrect ? 'text-success' : 'text-danger')}>
            {result.verdict}
          </p>
          {result.praise ? <p className="text-soft mt-1.5 text-[13px]">{result.praise}</p> : null}
          <p className="text-faint mt-2 text-[12px] tabular-nums">
            +{formatPoints(result.reward.points)} · уровень {result.rating.level}
          </p>
        </div>
      </div>

      {result.errors.length > 0 ? (
        <ul className="border-line mt-5 space-y-3 border-t pt-4">
          {result.errors.map((error) => (
            <li key={`${error.fragment}-${error.problem}`}>
              <p className="text-danger text-[13px] line-through decoration-1">{error.fragment}</p>
              <p className="text-ink mt-0.5 text-[13px]">{error.fix}</p>
              <p className="text-faint mt-0.5 text-[12px]">{error.problem}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {result.better ? (
        <div className="border-line mt-5 border-t pt-4">
          <p className="text-faint mb-1.5 text-[12px] font-medium tracking-wide uppercase">
            {task.type === 'grammar_quiz' || task.type === 'cloze' ? 'Верный вариант' : 'Как лучше'}
          </p>
          <p className="text-ink text-[15px] leading-relaxed">{result.better}</p>
        </div>
      ) : null}

      {reference.explanation ?? reference.referenceTranslation ?? reference.translation ? (
        <div className="border-line mt-5 space-y-1.5 border-t pt-4">
          {reference.referenceTranslation ? (
            <p className="text-soft text-[13px]">
              <span className="text-faint">Образец: </span>
              {reference.referenceTranslation}
            </p>
          ) : null}
          {reference.translation ? (
            <p className="text-soft text-[13px]">
              <span className="text-faint">Перевод: </span>
              {reference.translation}
            </p>
          ) : null}
          {reference.explanation ? <p className="text-soft text-[13px]">{reference.explanation}</p> : null}
        </div>
      ) : null}

      <Button variant="primary" className="mt-5" onClick={onNext}>
        Следующее задание
      </Button>
    </Card>
  );
}
