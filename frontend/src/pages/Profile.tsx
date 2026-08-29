import { useState } from 'react';
import { Ring } from '../components/charts';
import { RatingPoints } from '../components/RatingPoints';
import { SwitchField } from '../components/Switch';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Progress,
  SectionTitle,
  Select,
  Stat,
  cx,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDate, formatNumber, formatRub, formatUsd, plural } from '../lib/format';
import type { AiUsageOverview, CefrLevel } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';
import { THEME_UNLOCK_LEVEL, useUi } from '../store/ui';

const LEVELS: { value: CefrLevel; label: string }[] = [
  { value: 'A1', label: 'A1 — начальный' },
  { value: 'A2', label: 'A2 — базовый' },
  { value: 'B1', label: 'B1 — средний' },
  { value: 'B2', label: 'B2 — выше среднего' },
  { value: 'C1', label: 'C1 — продвинутый' },
  { value: 'C2', label: 'C2 — свободный' },
];

const GOALS = [10, 20, 30, 50, 80];

export function Profile() {
  const user = useAuth((state) => state.user);
  const updateSettings = useAuth((state) => state.updateSettings);
  const logout = useAuth((state) => state.logout);
  const notify = useUi((state) => state.notify);
  const theme = useUi((state) => state.theme);
  const setTheme = useUi((state) => state.setTheme);
  const unlockedThemes = useUi((state) => state.unlockedThemes);

  const health = useAsync(() => api.health(), []);
  const rewards = useAsync(() => api.rewards.list(), []);
  const aiUsage = useAsync(() => api.stats.aiUsage(), []);

  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <Loading />;

  const progress = user.progress;

  const save = async (patch: Parameters<typeof updateSettings>[0], quiet = false) => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(patch);
      if (!quiet) notify({ title: 'Сохранено', tone: 'success' });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Профиль" description={`С нами с ${formatDate(user.createdAt)}`} />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* ─── Основное ─── */}
          <Card>
            <SectionTitle title="Об аккаунте" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Имя" value={name} onChange={(event) => setName(event.target.value)} />
              <Input label="Почта" value={user.email} disabled />
              <Select
                label="Ваш уровень английского"
                value={user.cefrLevel}
                onChange={(event) => void save({ cefrLevel: event.target.value as CefrLevel })}
              >
                {LEVELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Дневная цель"
                value={String(user.dailyGoalWords)}
                onChange={(event) => void save({ dailyGoalWords: Number(event.target.value) })}
              >
                {GOALS.map((value) => (
                  <option key={value} value={value}>
                    {plural(value, 'слово', 'слова', 'слов')} в день
                  </option>
                ))}
              </Select>
            </div>

            {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}

            {name !== user.name ? (
              <Button variant="primary" className="mt-4" loading={saving} onClick={() => void save({ name })}>
                Сохранить имя
              </Button>
            ) : null}

            <p className="text-faint mt-4 text-[12px]">
              Уровень влияет на отбор слов и сложность заданий ИИ. Его можно менять в любой момент.
            </p>
          </Card>

          {/* ─── Поведение тренажёра ─── */}
          <Card>
            <SectionTitle title="Тренажёр" description="Настройки применяются сразу" />
            <div className="space-y-1">
              <SwitchField
                label="Прощать опечатки"
                description="До двух опечаток в слове засчитываются как верный ответ (в коротких — не больше одной), но награда снижается."
                checked={user.typoTolerance}
                onChange={(value) => void save({ typoTolerance: value }, true)}
              />
              <SwitchField
                label="Озвучка"
                description="Слова и реплики репетитора произносятся синтезатором браузера."
                checked={user.soundEnabled}
                onChange={(value) => void save({ soundEnabled: value }, true)}
              />
              <SwitchField
                label="Показывать транскрипцию"
                description="Транскрипция выводится рядом со словом, если она известна."
                checked={user.showTranscript}
                onChange={(value) => void save({ showTranscript: value }, true)}
              />
            </div>
          </Card>

          <AiUsageSection data={aiUsage.data} loading={aiUsage.loading} />

          {/* ─── Оформление ─── */}
          <Card>
            <SectionTitle title="Оформление" />
            <div className="flex gap-2">
              {              (
                [
                  { value: 'light', label: 'Светлая', hint: 'белый фон, максимум воздуха' },
                  { value: 'paper', label: 'Бумага', hint: 'тёплый оттенок, мягче для глаз' },
                  { value: 'night', label: 'Ночь', hint: 'тёмная тема' },
                ] as const
              ).map((option) => {
                const locked = !unlockedThemes.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTheme(option.value)}
                    className={cx(
                      'flex-1 rounded-xl border p-3 text-left transition-colors duration-150',
                      theme === option.value ? 'border-ink' : 'border-line hover:border-line-strong',
                      locked && 'opacity-50',
                    )}
                  >
                    <span className="text-ink block text-[13px] font-medium">{option.label}</span>
                    <span className="text-faint mt-0.5 block text-[12px] leading-snug">
                      {locked ? `Откроется на ${THEME_UNLOCK_LEVEL[option.value]} уровне` : option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ─── Источники данных ─── */}
          <Card>
            <SectionTitle title="Откуда словарь" description="Данные импортированы один раз из открытых наборов" />
            {health.data ? (
              <>
                <p className="text-soft text-[13px]">
                  В общем словаре {formatNumber(health.data.words)} слов. Модуль ИИ{' '}
                  {health.data.aiEnabled ? 'подключён' : 'выключен'}.
                </p>
                <ul className="text-faint mt-3 space-y-1 text-[12px] leading-relaxed">
                  {health.data.attribution.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              <Loading label="" />
            )}
          </Card>
        </div>

        {/* ─── Сводка ─── */}
        <aside className="space-y-5">
          <Card>
            <div className="flex items-center gap-4">
              <Ring value={progress.progress} size={80}>
                <span className="text-[17px] font-semibold tabular-nums">{progress.level}</span>
              </Ring>
              <div>
                <p className="text-ink text-sm font-medium">Уровень {progress.level} из 1000</p>
                <p className="text-faint mt-0.5 text-[12px] tabular-nums">
                  {progress.isMax
                    ? 'максимальный уровень'
                    : `${formatNumber(progress.pointsIntoLevel)} / ${formatNumber(progress.pointsForLevel)} очков`}
                </p>
                <Progress className="mt-2 w-32" value={progress.progress} />
              </div>
            </div>

            <div className="border-line mt-5 grid grid-cols-2 gap-4 border-t pt-5">
              <Stat label="Очки рейтинга" value={<RatingPoints amount={user.points} />} />
              <Stat
                label="До уровня выше"
                value={progress.isMax ? '—' : formatNumber(progress.pointsToNext)}
              />
              <Stat label="Серия" value={plural(user.dailyStreak, 'день', 'дня', 'дней')} tone="accent" />
              <Stat label="Максимум" value={plural(user.longestStreak, 'день', 'дня', 'дней')} />
            </div>
          </Card>

          <Card>
            <SectionTitle title="Открыто уровнем" description="Награды выдаются за рост рейтинга" />
            {rewards.data ? (
              <ul className="space-y-2">
                <li className="flex items-center justify-between text-[13px]">
                  <span className="text-ink">Заморозка серии</span>
                  <Badge tone={rewards.data.streakFreezes > 0 ? 'accent' : 'neutral'}>
                    ×{rewards.data.streakFreezes}
                  </Badge>
                </li>
                {rewards.data.items
                  .filter((item) => item.unlocked && item.kind !== 'freeze')
                  .map((item) => (
                    <li key={item.code} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-ink truncate">{item.title}</span>
                      <Badge tone="success">{item.level} ур.</Badge>
                    </li>
                  ))}
              </ul>
            ) : (
              <Loading label="" />
            )}
          </Card>

          <Card>
            <SectionTitle title="Сессия" />
            <Button variant="danger" block onClick={logout}>
              Выйти из аккаунта
            </Button>
            <p className="text-faint mt-3 text-[12px] leading-relaxed">
              Прогресс, словарь и статистика останутся привязаны к аккаунту.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function AiUsageSection({ data, loading }: { data: AiUsageOverview | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <Card>
        <SectionTitle title="Расход на нейросети" />
        <Loading label="" />
      </Card>
    );
  }

  if (!data) return null;

  const { allTime, month, today, pricing, monthReferenceUsd } = data;
  const inputShare = allTime.totalTokens > 0 ? allTime.inputTokens / allTime.totalTokens : 0.5;
  const monthCostRatio = monthReferenceUsd > 0 ? month.costUsd / monthReferenceUsd : 0;

  return (
    <Card>
      <SectionTitle
        title="Расход на нейросети"
        description={
          data.enabled && data.model
            ? `Оценка по тарифам ${data.model}: $${pricing.inputUsdPerM} / $${pricing.outputUsdPerM} за 1 млн токенов (вход / выход)`
            : 'ИИ выключен — расход появится после первых заданий с ключом OpenAI'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Всего потрачено"
          value={formatUsd(allTime.costUsd)}
          hint={`≈ ${formatRub(allTime.costRub)} · курс ${pricing.usdRubRate} ₽/$`}
          tone={allTime.costUsd > 0 ? 'accent' : undefined}
        />
        <Stat
          label="За этот месяц"
          value={formatUsd(month.costUsd)}
          hint={`сегодня ${formatUsd(today.costUsd)} · ${formatNumber(allTime.requests)} ${plural(allTime.requests, 'запрос', 'запроса', 'запросов')}`}
        />
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12px]">
            <span className="text-soft">Токены за всё время</span>
            <span className="text-faint tabular-nums">{formatNumber(allTime.totalTokens)}</span>
          </div>
          <div className="bg-sunken flex h-2 overflow-hidden rounded-full">
            <div className="bg-ink h-full transition-[width] duration-500" style={{ width: `${inputShare * 100}%` }} />
            <div className="bg-accent h-full transition-[width] duration-500" style={{ width: `${(1 - inputShare) * 100}%` }} />
          </div>
          <div className="text-faint mt-1.5 flex justify-between text-[11px] tabular-nums">
            <span>вход {formatNumber(allTime.inputTokens)}</span>
            <span>выход {formatNumber(allTime.outputTokens)}</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12px]">
            <span className="text-soft">Расход за месяц</span>
            <span className="text-faint tabular-nums">
              {formatUsd(month.costUsd)} / ~{formatUsd(monthReferenceUsd)}
            </span>
          </div>
          <Progress value={Math.min(monthCostRatio, 1)} tone="accent" />
          <p className="text-faint mt-1.5 text-[11px] leading-relaxed">
            Шкала ориентировочная (~{formatUsd(monthReferenceUsd)} в месяц), не лимит аккаунта.
          </p>
        </div>
      </div>

      {allTime.totalTokens === 0 ? (
        <p className="text-soft mt-4 text-[13px]">Пока нет данных — выполните задание ИИ или поговорите с репетитором.</p>
      ) : null}
    </Card>
  );
}

