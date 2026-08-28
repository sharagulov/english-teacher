import { Link } from 'react-router-dom';
import { ActivityCalendar, AreaChart, Ring, StackedBar } from '../components/charts';
import { Badge, Card, EmptyState, ErrorNote, LinkButton, Loading, SectionTitle, Stat } from '../components/ui';
import { api } from '../lib/api';
import { formatDayKey, formatDuration, formatNumber, formatPercent, plural } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';

export function Dashboard() {
  const user = useAuth((state) => state.user);
  const stats = useAsync(() => api.stats.overview(), []);
  const daily = useAsync(() => api.stats.daily(30), []);

  if (stats.loading && !stats.data) return <Loading label="Собираем статистику" />;
  if (stats.error) return <ErrorNote message={stats.error} onRetry={stats.reload} />;
  if (!stats.data || !user) return null;

  const { words, answers, today, review, pools, economy } = stats.data;
  const series = daily.data?.series ?? [];

  const goalDone = today.goalProgress >= 1;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p className="text-soft mt-1 text-sm">
            {goalDone
              ? 'Дневная цель выполнена. Всё, что дальше, — сверх плана.'
              : `До дневной цели осталось ${plural(today.goal - today.correct, 'слово', 'слова', 'слов')}.`}
          </p>
        </div>

        <div className="flex gap-2">
          <LinkButton to="/practice" variant="primary" size="lg" className="px-5">
            Заниматься
          </LinkButton>
        </div>
      </header>

      {/* ─── Дневная цель и серия ─── */}
      <Card className="flex flex-wrap items-center gap-x-10 gap-y-6">
        <div className="flex items-center gap-4">
          <Ring value={today.goalProgress} tone={goalDone ? 'success' : 'accent'} size={78}>
            <span className="text-[15px] font-semibold tabular-nums">
              {today.correct}
              <span className="text-faint">/{today.goal}</span>
            </span>
          </Ring>
          <div>
            <p className="text-[13px] font-medium">Сегодня</p>
            <p className="text-soft mt-0.5 text-[12px]">
              {plural(today.attempts, 'ответ', 'ответа', 'ответов')} · {formatDuration(today.timeMs)}
            </p>
            <p className="text-faint mt-0.5 text-[12px]">
              +{today.coins} монет, +{today.xp} опыта
            </p>
          </div>
        </div>

        <div className="border-line hidden h-14 border-l sm:block" />

        <Stat
          label="Дневная серия"
          value={plural(user.dailyStreak, 'день', 'дня', 'дней')}
          hint={`Лучшая серия — ${plural(user.longestStreak, 'день', 'дня', 'дней')}`}
        />

        <Stat
          label="К повторению"
          value={formatNumber(review.dueNow)}
          hint={review.dueTomorrow > 0 ? `Завтра ещё ${review.dueTomorrow}` : 'На сегодня всё'}
          tone={review.dueNow > 0 ? 'accent' : undefined}
        />

        <Stat label="Точность" value={formatPercent(answers.accuracy)} hint={`${formatNumber(answers.attempts)} ответов всего`} />

        {user.streakFreezes > 0 ? (
          <Badge tone="accent">Заморозок серии: {user.streakFreezes}</Badge>
        ) : null}
      </Card>

      {/* ─── Словарь ─── */}
      <section>
        <SectionTitle
          title="Ваш словарь"
          description={`Встречено ${formatNumber(words.encountered)} из ${formatNumber(words.dictionaryTotal)} слов (${formatPercent(words.coverage, 1)})`}
          action={
            <Link to="/stats" className="text-accent text-[13px] hover:underline">
              Подробная статистика
            </Link>
          }
        />
        <Card>
          {words.encountered === 0 ? (
            <EmptyState
              title="Вы ещё не начали"
              description="Соберите первый пулл слов — это займёт пару минут."
              action={
                <LinkButton to="/practice" variant="primary">
                  Собрать пулл
                </LinkButton>
              }
            />
          ) : (
            <>
              <StackedBar
                segments={[
                  { label: 'Изучается', value: words.learning, color: 'var(--warning)' },
                  { label: 'На повторении', value: words.review, color: 'var(--accent)' },
                  { label: 'Освоено', value: words.mastered, color: 'var(--success)' },
                  { label: 'Проблемные', value: words.leech, color: 'var(--danger)' },
                ]}
              />
              <div className="border-line mt-5 grid grid-cols-2 gap-5 border-t pt-5 sm:grid-cols-4">
                <Stat label="Изучено" value={formatNumber(words.learned)} hint="повторение или освоено" />
                <Stat label="Освоено" value={formatNumber(words.mastered)} tone="success" />
                <Stat label="Пуллов пройдено" value={formatNumber(pools.completed)} hint={`без ошибок — ${pools.perfect}`} />
                <Stat label="Средний ответ" value={`${(answers.avgResponseMs / 1000).toFixed(1)} с`} />
              </div>
            </>
          )}
        </Card>
      </section>

      {/* ─── Активность ─── */}
      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Ответы за месяц" />
          {daily.loading ? (
            <Loading label="" />
          ) : (
            <AreaChart
              points={series.map((point) => ({ label: formatDayKey(point.day), value: point.attempts }))}
              formatValue={(value) => plural(value, 'ответ', 'ответа', 'ответов')}
            />
          )}
        </Card>

        <Card>
          <SectionTitle title="Новые слова за месяц" />
          {daily.loading ? (
            <Loading label="" />
          ) : (
            <AreaChart
              tone="success"
              points={series.map((point) => ({ label: formatDayKey(point.day), value: point.newWords }))}
              formatValue={(value) => plural(value, 'слово', 'слова', 'слов')}
            />
          )}
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_auto]">
        <Card>
          <SectionTitle title="Занятия по дням" description="Чем насыщеннее цвет, тем больше ответов за день" />
          <ActivityCalendar
            days={series.map((point) => ({
              day: point.day,
              value: point.attempts,
              label: `${formatDayKey(point.day)} — ${plural(point.attempts, 'ответ', 'ответа', 'ответов')}`,
            }))}
          />
        </Card>

        <Card className="lg:w-64">
          <SectionTitle title="Монеты" />
          <div className="space-y-4">
            <Stat label="Баланс" value={formatNumber(economy.balance)} />
            <Stat label="Заработано" value={formatNumber(economy.earned)} tone="success" />
            <Stat label="Потрачено" value={formatNumber(economy.spent)} />
          </div>
          <LinkButton to="/shop" size="sm" variant="secondary" block className="mt-5">
            В магазин
          </LinkButton>
        </Card>
      </section>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}
