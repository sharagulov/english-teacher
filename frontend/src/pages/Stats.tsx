import { useEffect, useState } from 'react';
import { AreaChart, BarChart, HourHeatmap, Ring, StackedBar } from '../components/charts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  SectionTitle,
  Select,
  Stat,
  cx,
} from '../components/ui';
import { api } from '../lib/api';
import {
  MODE_LABELS,
  MATCH_TYPE_LABELS,
  WORD_STATUS_LABELS,
  formatDateTime,
  formatDayKey,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
  formatResponseTime,
  plural,
  transactionLabel,
} from '../lib/format';
import { useAsync } from '../lib/useAsync';
import type { CefrLevel, WordStatus } from '../lib/types';

type Tab = 'overview' | 'words' | 'activity' | 'economy' | 'achievements';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Итоги' },
  { id: 'words', label: 'Слова' },
  { id: 'activity', label: 'Активность' },
  { id: 'economy', label: 'Экономика' },
  { id: 'achievements', label: 'Достижения' },
];

export function Stats() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div>
      <PageHeader title="Статистика" description="Всё, что можно измерить в ваших занятиях." />

      <div className="border-line mb-6 flex gap-1 overflow-x-auto border-b">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150',
              tab === item.id ? 'border-ink text-ink' : 'text-soft hover:text-ink border-transparent',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'words' ? <WordsTab /> : null}
      {tab === 'activity' ? <ActivityTab /> : null}
      {tab === 'economy' ? <EconomyTab /> : null}
      {tab === 'achievements' ? <AchievementsTab /> : null}
    </div>
  );
}

// ─────────────────────────────── Итоги ───────────────────────────────

function OverviewTab() {
  const overview = useAsync(() => api.stats.overview(), []);
  const breakdown = useAsync(() => api.stats.breakdown(), []);

  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error) return <ErrorNote message={overview.error} onRetry={overview.reload} />;
  if (!overview.data) return null;

  const { words, answers, today, review, pools, ai, economy, user } = overview.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Всего ответов" value={formatNumber(answers.attempts)} hint={`точность ${formatPercent(answers.accuracy, 1)}`} />
        </Card>
        <Card>
          <Stat label="Слов изучено" value={formatNumber(words.learned)} hint={`освоено ${words.mastered}`} tone="success" />
        </Card>
        <Card>
          <Stat label="Время в тренажёре" value={formatDuration(answers.totalTimeMs)} hint={`ср. ответ ${formatResponseTime(answers.avgResponseMs)}`} />
        </Card>
        <Card>
          <Stat label="Дневная серия" value={plural(user.dailyStreak, 'день', 'дня', 'дней')} hint={`максимум ${user.longestStreak}`} tone="accent" />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <SectionTitle title="Состояние словаря" description={`Встречено ${formatNumber(words.encountered)} из ${formatNumber(words.dictionaryTotal)}`} />
          <StackedBar
            segments={[
              { label: 'Новые в работе', value: words.learning, color: 'var(--warning)' },
              { label: 'На повторении', value: words.review, color: 'var(--accent)' },
              { label: 'Освоено', value: words.mastered, color: 'var(--success)' },
              { label: 'Проблемные', value: words.leech, color: 'var(--danger)' },
            ]}
          />
          <div className="border-line mt-5 grid grid-cols-2 gap-5 border-t pt-5 sm:grid-cols-4">
            <Stat label="Покрытие" value={formatPercent(words.coverage, 1)} />
            <Stat label="К повтору сейчас" value={formatNumber(review.dueNow)} tone={review.dueNow > 0 ? 'accent' : undefined} />
            <Stat label="Завтра" value={formatNumber(review.dueTomorrow)} />
            <Stat label="За неделю" value={formatNumber(review.dueWeek)} />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Сегодня" />
          <div className="flex items-center gap-5">
            <Ring value={today.goalProgress} tone={today.goalProgress >= 1 ? 'success' : 'accent'} size={84}>
              <span className="text-[15px] font-semibold tabular-nums">
                {today.correct}
                <span className="text-faint">/{today.goal}</span>
              </span>
            </Ring>
            <div className="space-y-2.5">
              <Field label="Ответов" value={formatNumber(today.attempts)} />
              <Field label="Новых слов" value={formatNumber(today.newWords)} />
              <Field label="Время" value={formatDuration(today.timeMs)} />
              <Field label="Монет" value={`+${formatNumber(today.coins)}`} />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title="По режимам" description="Где точность выше, а где стоит поднажать" />
          {breakdown.data ? (
            <BarChart
              items={breakdown.data.byMode.map((row) => ({
                label: MODE_LABELS[row.mode] ?? row.mode,
                value: row.attempts,
                caption: `${formatPercent(row.accuracy, 0)} · ${formatResponseTime(row.avgResponseMs)}`,
              }))}
              formatValue={(value) => plural(value, 'ответ', 'ответа', 'ответов')}
            />
          ) : (
            <Loading label="" />
          )}
        </Card>

        <Card>
          <SectionTitle title="По уровням" />
          {breakdown.data ? (
            breakdown.data.byLevel.length === 0 ? (
              <EmptyState title="Нет данных" />
            ) : (
              <ul className="space-y-3">
                {breakdown.data.byLevel.map((row) => (
                  <li key={row.level}>
                    <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                      <span className="text-ink font-medium">{row.level}</span>
                      <span className="text-faint tabular-nums">{formatNumber(row.total)}</span>
                    </div>
                    <StackedBar
                      height={8}
                      segments={[
                        { label: 'новые', value: row.new, color: 'var(--surface-sunken)' },
                        { label: 'изучаются', value: row.learning, color: 'var(--warning)' },
                        { label: 'повторение', value: row.review, color: 'var(--accent)' },
                        { label: 'освоено', value: row.mastered, color: 'var(--success)' },
                        { label: 'проблемные', value: row.leech, color: 'var(--danger)' },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Loading label="" />
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Как вы отвечаете" />
          {breakdown.data ? (
            <BarChart
              tone="accent"
              items={breakdown.data.byMatchType.map((row) => ({
                label: MATCH_TYPE_LABELS[row.matchType] ?? row.matchType,
                value: row.count,
              }))}
            />
          ) : (
            <Loading label="" />
          )}
          <div className="border-line mt-5 grid grid-cols-2 gap-5 border-t pt-5">
            <Stat label="Лучшая серия слова" value={formatNumber(answers.bestWordStreak)} />
            <Stat label="Заданий ИИ" value={formatNumber(ai.submissions)} />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Темы" description="Где ошибок больше всего" />
          {breakdown.data ? (
            <BarChart
              items={breakdown.data.byTopic.slice(0, 10).map((row) => ({
                label: row.topic,
                value: row.attempts,
                caption: formatPercent(row.accuracy, 0),
              }))}
              formatValue={(value) => plural(value, 'ответ', 'ответа', 'ответов')}
            />
          ) : (
            <Loading label="" />
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle title="Пуллы" />
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Завершено" value={formatNumber(pools.completed)} />
          <Stat label="Без ошибок" value={formatNumber(pools.perfect)} tone="success" />
          <Stat label="Заработано монет" value={formatNumber(economy.earned)} />
          <Stat label="Потрачено" value={formatNumber(economy.spent)} />
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────── Слова ───────────────────────────────

const STATUSES: WordStatus[] = ['new', 'learning', 'review', 'mastered', 'leech'];
const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const SORTS: { value: string; label: string }[] = [
  { value: 'dueAt', label: 'по сроку повторения' },
  { value: 'timesWrong', label: 'по числу ошибок' },
  { value: 'strength', label: 'по силе' },
  { value: 'lastSeenAt', label: 'по последнему показу' },
  { value: 'timesSeen', label: 'по числу показов' },
];

function WordsTab() {
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState<CefrLevel | ''>('');
  const [sort, setSort] = useState('timesWrong');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [favorite, setFavorite] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const rows = useAsync(
    () =>
      api.stats.words({
        page,
        perPage: 25,
        sort,
        order,
        ...(status ? { status } : {}),
        ...(level ? { level } : {}),
        ...(favorite ? { favorite: true } : {}),
        ...(debounced ? { search: debounced } : {}),
      }),
    [status, level, sort, order, favorite, debounced, page],
  );

  const totalPages = rows.data ? Math.max(1, Math.ceil(rows.data.total / rows.data.perPage)) : 1;

  return (
    <div>
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input label="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="слово" />
          <Select label="Статус" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Любой</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {WORD_STATUS_LABELS[item]}
              </option>
            ))}
          </Select>
          <Select label="Уровень" value={level} onChange={(event) => { setLevel(event.target.value as CefrLevel | ''); setPage(1); }}>
            <option value="">Любой</option>
            {LEVELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select label="Сортировка" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select label="Порядок" value={order} onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')}>
            <option value="desc">по убыванию</option>
            <option value="asc">по возрастанию</option>
          </Select>
        </div>

        <label className="text-soft mt-4 flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={favorite}
            onChange={(event) => { setFavorite(event.target.checked); setPage(1); }}
            className="accent-ink h-4 w-4"
          />
          Только избранные
        </label>
      </Card>

      {rows.error ? <ErrorNote message={rows.error} onRetry={rows.reload} /> : null}

      {rows.loading && !rows.data ? (
        <Loading />
      ) : (rows.data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState title="Нет слов по этим условиям" description="Ослабьте фильтры или начните тренировку." />
        </Card>
      ) : (
        <>
          <Card padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-line text-faint border-b text-left">
                    <th className="px-4 py-2.5 font-medium">Слово</th>
                    <th className="px-4 py-2.5 font-medium">Перевод</th>
                    <th className="px-3 py-2.5 font-medium">Статус</th>
                    <th className="px-3 py-2.5 text-right font-medium">Показы</th>
                    <th className="px-3 py-2.5 text-right font-medium">Ошибки</th>
                    <th className="px-3 py-2.5 text-right font-medium">Точность</th>
                    <th className="px-3 py-2.5 text-right font-medium">Сила</th>
                    <th className="px-4 py-2.5 text-right font-medium">Повтор</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data?.items.map((row) => (
                    <tr key={row.wordId} className="border-line/60 hover:bg-sunken/60 border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="word-display text-ink font-medium">{row.text}</span>
                        {row.isFavorite ? <span className="text-warning ml-1.5">★</span> : null}
                      </td>
                      <td className="text-soft max-w-56 truncate px-4 py-2.5">{row.translations.join(', ')}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={row.status === 'mastered' ? 'success' : row.status === 'leech' ? 'danger' : 'neutral'}>
                          {WORD_STATUS_LABELS[row.status]}
                        </Badge>
                      </td>
                      <td className="text-soft px-3 py-2.5 text-right tabular-nums">{row.timesSeen}</td>
                      <td className={cx('px-3 py-2.5 text-right tabular-nums', row.timesWrong > 0 ? 'text-danger' : 'text-soft')}>
                        {row.timesWrong}
                      </td>
                      <td className="text-soft px-3 py-2.5 text-right tabular-nums">{formatPercent(row.accuracy, 0)}</td>
                      <td className="text-soft px-3 py-2.5 text-right tabular-nums">{formatPercent(row.strength, 0)}</td>
                      <td className="text-faint px-4 py-2.5 text-right whitespace-nowrap">{formatRelative(row.dueAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-5 flex items-center justify-center gap-2">
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
    </div>
  );
}

// ─────────────────────────────── Активность ───────────────────────────────

function ActivityTab() {
  const [days, setDays] = useState(30);
  const daily = useAsync(() => api.stats.daily(days), [days]);
  const breakdown = useAsync(() => api.stats.breakdown(), []);
  const pools = useAsync(() => api.stats.pools(20), []);

  const series = daily.data?.series ?? [];

  return (
    <div className="space-y-5">
      <div className="flex gap-1.5">
        {[7, 30, 90].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setDays(value)}
            className={cx(
              'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
              days === value ? 'border-ink bg-ink text-surface' : 'border-line text-soft hover:border-line-strong',
            )}
          >
            {value} дней
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Ответы" />
          {daily.loading && !daily.data ? (
            <Loading label="" />
          ) : (
            <AreaChart
              points={series.map((point) => ({ label: formatDayKey(point.day), value: point.attempts }))}
              formatValue={(value) => plural(value, 'ответ', 'ответа', 'ответов')}
            />
          )}
        </Card>
        <Card>
          <SectionTitle title="Точность по дням" />
          {daily.loading && !daily.data ? (
            <Loading label="" />
          ) : (
            <AreaChart
              tone="success"
              points={series.map((point) => ({ label: formatDayKey(point.day), value: (point.accuracy ?? 0) * 100 }))}
              formatValue={(value) => `${Math.round(value)}%`}
            />
          )}
        </Card>
        <Card>
          <SectionTitle title="Новые слова" />
          {daily.loading && !daily.data ? (
            <Loading label="" />
          ) : (
            <AreaChart
              points={series.map((point) => ({ label: formatDayKey(point.day), value: point.newWords }))}
              formatValue={(value) => plural(value, 'слово', 'слова', 'слов')}
            />
          )}
        </Card>
        <Card>
          <SectionTitle title="Время занятий" />
          {daily.loading && !daily.data ? (
            <Loading label="" />
          ) : (
            <AreaChart
              tone="success"
              points={series.map((point) => ({ label: formatDayKey(point.day), value: Math.round(point.timeMs / 60000) }))}
              formatValue={(value) => `${Math.round(value)} мин`}
            />
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle title="Часы занятий" description="В какое время суток вы отвечаете точнее" />
        {breakdown.data ? <HourHeatmap hours={breakdown.data.byHour} /> : <Loading label="" />}
      </Card>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <SectionTitle title="Последние пуллы" />
        </div>
        {pools.loading && !pools.data ? (
          <Loading label="" />
        ) : (pools.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Пуллов пока нет" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-line text-faint border-b text-left">
                  <th className="px-5 py-2.5 font-medium">Режим</th>
                  <th className="px-3 py-2.5 font-medium">№</th>
                  <th className="px-3 py-2.5 text-right font-medium">Слов</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ошибок</th>
                  <th className="px-3 py-2.5 text-right font-medium">Монет</th>
                  <th className="px-3 py-2.5 text-right font-medium">Время</th>
                  <th className="px-5 py-2.5 text-right font-medium">Когда</th>
                </tr>
              </thead>
              <tbody>
                {pools.data?.items.map((pool) => (
                  <tr key={pool.id} className="border-line/60 border-b last:border-0">
                    <td className="text-ink px-5 py-2.5">{MODE_LABELS[pool.mode] ?? pool.mode}</td>
                    <td className="text-faint px-3 py-2.5 tabular-nums">{pool.ordinal}</td>
                    <td className="text-soft px-3 py-2.5 text-right tabular-nums">{pool.size}</td>
                    <td className={cx('px-3 py-2.5 text-right tabular-nums', pool.wrongCount > 0 ? 'text-danger' : 'text-success')}>
                      {pool.wrongCount}
                    </td>
                    <td className="text-soft px-3 py-2.5 text-right tabular-nums">+{pool.coinsEarned}</td>
                    <td className="text-soft px-3 py-2.5 text-right tabular-nums">{formatDuration(pool.durationMs)}</td>
                    <td className="text-faint px-5 py-2.5 text-right whitespace-nowrap">
                      {pool.completedAt ? formatRelative(pool.completedAt) : 'не закрыт'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────── Экономика ───────────────────────────────

function EconomyTab() {
  const transactions = useAsync(() => api.stats.transactions(60), []);

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <SectionTitle title="История операций" description="Каждое начисление и списание монет" />
      </div>

      {transactions.loading && !transactions.data ? (
        <Loading label="" />
      ) : (transactions.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Операций пока нет" />
      ) : (
        <ul>
          {transactions.data?.items.map((item) => (
            <li key={item.id} className="border-line/60 flex items-center gap-4 border-b px-5 py-3 last:border-0">
              <span
                className={cx(
                  'w-16 shrink-0 text-[14px] font-semibold tabular-nums',
                  item.amount >= 0 ? 'text-success' : 'text-danger',
                )}
              >
                {item.amount >= 0 ? '+' : ''}
                {item.amount}
              </span>
              <span className="text-ink min-w-0 flex-1 text-[13px]">{transactionLabel(item.reason)}</span>
              <span className="text-faint shrink-0 text-[12px] tabular-nums">
                баланс {formatNumber(item.balanceAfter)}
              </span>
              <span className="text-faint hidden shrink-0 text-[12px] sm:inline">{formatDateTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─────────────────────────────── Достижения ───────────────────────────────

function AchievementsTab() {
  const achievements = useAsync(() => api.stats.achievements(), []);

  if (achievements.loading && !achievements.data) return <Loading />;
  if (achievements.error) return <ErrorNote message={achievements.error} onRetry={achievements.reload} />;

  const items = achievements.data?.items ?? [];
  const unlocked = items.filter((item) => item.unlockedAt);

  return (
    <div>
      <p className="text-soft mb-5 text-[13px]">
        Открыто {unlocked.length} из {items.length}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const done = Boolean(item.unlockedAt);
          return (
            <Card key={item.code} className={cx(!done && 'opacity-55')}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-ink text-sm font-medium">{item.title}</p>
                {done ? <Badge tone="success">открыто</Badge> : <Badge>{item.threshold}</Badge>}
              </div>
              <p className="text-soft mt-1.5 text-[13px] leading-relaxed">{item.description}</p>
              <p className="text-faint mt-2.5 text-[12px] tabular-nums">
                +{item.coins} монет · +{item.xp} опыта
                {item.unlockedAt ? ` · ${formatRelative(item.unlockedAt)}` : ''}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-faint text-[12px]">{label}</span>
      <span className="text-ink text-[13px] font-medium tabular-nums">{value}</span>
    </div>
  );
}
