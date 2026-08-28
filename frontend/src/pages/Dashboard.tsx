import { Link } from 'react-router-dom';
import { ActivityCalendar, AreaChart } from '../components/charts';
import { Card, ErrorNote, LinkButton, Loading, Progress } from '../components/ui';
import { api } from '../lib/api';
import { formatDayKey, formatDuration, formatNumber, formatPercent, formatPoints, plural } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';

export function Dashboard() {
  const user = useAuth((state) => state.user);
  const stats = useAsync(() => api.stats.overview(), []);
  const daily = useAsync(() => api.stats.daily(30), []);

  if (stats.loading && !stats.data) return <Loading label="Собираем статистику" />;
  if (stats.error) return <ErrorNote message={stats.error} onRetry={stats.reload} />;
  if (!stats.data || !user) return null;

  const { words, answers, today, review } = stats.data;
  const series = daily.data?.series ?? [];
  const goalDone = today.goalProgress >= 1;
  const firstName = user.name.split(' ')[0];

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="word-display text-[34px] leading-[1.1] font-semibold tracking-tight sm:text-[42px]">
            {greeting()}, {firstName}
          </h1>
          <p className="text-soft mt-2 max-w-md text-[14px] leading-relaxed">
            {words.encountered === 0
              ? 'Соберите первый пулл — это займёт пару минут.'
              : goalDone
                ? 'Дневная цель выполнена. Дальше — сверх плана.'
                : `До цели осталось ${plural(today.goal - today.correct, 'слово', 'слова', 'слов')}.`}
          </p>
        </div>

        <LinkButton
          to="/practice"
          variant="primary"
          size="lg"
          className="h-14 shrink-0 px-8 text-[16px] sm:min-w-[200px]"
        >
          Заниматься
        </LinkButton>
      </header>

      <Card className="p-6 sm:p-8">
        <p className="text-faint text-[12px] font-medium tracking-wide uppercase">Сегодня</p>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <p className="word-display text-[56px] leading-none font-semibold tracking-tight sm:text-[72px]">
            {today.correct}
          </p>
          <p className="text-faint mb-1.5 text-[22px] font-medium tabular-nums sm:mb-2 sm:text-[28px]">/{today.goal}</p>
        </div>
        <Progress value={today.goalProgress} tone={goalDone ? 'success' : 'ink'} className="mt-5 h-1" />
        <p className="text-faint mt-3 text-[13px]">
          {today.attempts === 0
            ? 'Пока без ответов'
            : `${plural(today.attempts, 'ответ', 'ответа', 'ответов')} · ${formatDuration(today.timeMs)} · +${formatPoints(today.points)}`}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Metric
          label="К повторению"
          value={formatNumber(review.dueNow)}
          hint={review.dueTomorrow > 0 ? `завтра ещё ${formatNumber(review.dueTomorrow)}` : 'на сегодня всё'}
          highlight={review.dueNow > 0}
        />
        <Metric
          label="Серия"
          value={String(user.dailyStreak)}
          hint={`лучшая — ${user.longestStreak}`}
        />
        <Metric
          label="Точность"
          value={formatPercent(answers.accuracy)}
          hint={plural(answers.attempts, 'ответ', 'ответа', 'ответов')}
        />
        <Metric
          label="В словаре"
          value={formatNumber(words.learned)}
          hint={`${formatPercent(words.coverage)} покрытия`}
        />
      </div>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-[13px] font-medium tracking-wide text-faint uppercase">Ответы за месяц</h2>
          <Link to="/stats" className="text-faint hover:text-ink text-[13px] transition-colors">
            Вся статистика
          </Link>
        </div>
        <Card padded={false} className="overflow-hidden px-5 pt-5 pb-3">
          {daily.loading && series.length === 0 ? (
            <Loading label="" />
          ) : (
            <AreaChart
              height={120}
              points={series.map((point) => ({ label: formatDayKey(point.day), value: point.attempts }))}
              formatValue={(value) => plural(value, 'ответ', 'ответа', 'ответов')}
            />
          )}
        </Card>
        {series.length > 0 ? (
          <div className="mt-5">
            <ActivityCalendar
              days={series.map((point) => ({
                day: point.day,
                value: point.attempts,
                label: `${formatDayKey(point.day)} — ${plural(point.attempts, 'ответ', 'ответа', 'ответов')}`,
              }))}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-raised border-line rounded-2xl border px-4 py-5 sm:px-5">
      <p className="text-faint text-[12px] font-medium tracking-wide uppercase">{label}</p>
      <p
        className={`mt-2 text-[32px] leading-none font-semibold tracking-tight tabular-nums sm:text-[36px] ${highlight ? 'text-accent' : 'text-ink'}`}
      >
        {value}
      </p>
      <p className="text-faint mt-2 text-[12px] leading-snug">{hint}</p>
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
