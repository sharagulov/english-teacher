import { useState } from 'react';
import { Ring } from '../components/charts';
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
import { formatDate, formatNumber, plural } from '../lib/format';
import type { CefrLevel } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

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
  const inventory = useAsync(() => api.shop.inventory(), []);

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
              <Toggle
                label="Прощать опечатки"
                description="Ответ с одной опечаткой считается верным, но награда снижается."
                checked={user.typoTolerance}
                onChange={(value) => void save({ typoTolerance: value }, true)}
              />
              <Toggle
                label="Автопереход"
                description="После верного ответа следующее слово появляется само."
                checked={user.autoAdvance}
                onChange={(value) => void save({ autoAdvance: value }, true)}
              />
              <Toggle
                label="Озвучка"
                description="Слова и реплики репетитора произносятся синтезатором браузера."
                checked={user.soundEnabled}
                onChange={(value) => void save({ soundEnabled: value }, true)}
              />
              <Toggle
                label="Показывать транскрипцию"
                description="Транскрипция выводится рядом со словом, если она известна."
                checked={user.showTranscript}
                onChange={(value) => void save({ showTranscript: value }, true)}
              />
            </div>
          </Card>

          {/* ─── Оформление ─── */}
          <Card>
            <SectionTitle title="Оформление" />
            <div className="flex gap-2">
              {(
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
                      {locked ? 'Покупается в магазине' : option.hint}
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
                <p className="text-ink text-sm font-medium">Уровень {progress.level}</p>
                <p className="text-faint mt-0.5 text-[12px] tabular-nums">
                  {formatNumber(progress.xpIntoLevel)} / {formatNumber(progress.xpForLevel)} опыта
                </p>
                <Progress className="mt-2 w-32" value={progress.progress} />
              </div>
            </div>

            <div className="border-line mt-5 grid grid-cols-2 gap-4 border-t pt-5">
              <Stat label="Монеты" value={formatNumber(user.coins)} />
              <Stat label="Всего опыта" value={formatNumber(user.xp)} />
              <Stat label="Серия" value={plural(user.dailyStreak, 'день', 'дня', 'дней')} tone="accent" />
              <Stat label="Максимум" value={plural(user.longestStreak, 'день', 'дня', 'дней')} />
            </div>
          </Card>

          <Card>
            <SectionTitle title="Инвентарь" />
            {inventory.data ? (
              inventory.data.items.length === 0 && inventory.data.streakFreezes === 0 ? (
                <p className="text-faint text-[13px]">Пока ничего не куплено.</p>
              ) : (
                <ul className="space-y-2">
                  {inventory.data.streakFreezes > 0 ? (
                    <li className="flex items-center justify-between text-[13px]">
                      <span className="text-ink">Заморозка серии</span>
                      <Badge tone="accent">×{inventory.data.streakFreezes}</Badge>
                    </li>
                  ) : null}
                  {inventory.data.items.map((item) => (
                    <li key={item.itemCode} className="flex items-center justify-between text-[13px]">
                      <span className="text-ink">{item.itemCode}</span>
                      <Badge>×{item.quantity}</Badge>
                    </li>
                  ))}
                </ul>
              )
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

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="hover:bg-sunken/60 -mx-2 flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-ink mt-0.5 h-4 w-4 shrink-0"
      />
      <span>
        <span className="text-ink block text-[13px] font-medium">{label}</span>
        <span className="text-faint mt-0.5 block text-[12px] leading-relaxed">{description}</span>
      </span>
    </label>
  );
}
