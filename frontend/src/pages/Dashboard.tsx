import { Link } from 'react-router-dom';
import { AreaChart } from '../components/charts';
import { ErrorNote, Loading } from '../components/ui';
import { api } from '../lib/api';
import { formatDayKey, formatDuration, formatNumber, formatPercent, plural } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';
import type { DailyPoint } from '../lib/types';
export function Dashboard() {
    const user = useAuth((state) => state.user);
    const stats = useAsync(() => api.stats.overview(), []);
    const daily = useAsync(() => api.stats.daily(30), []);
    if (stats.loading && !stats.data)
        return <Loading label="Собираем статистику"/>;
    if (stats.error)
        return <ErrorNote message={stats.error} onRetry={stats.reload}/>;
    if (!stats.data || !user)
        return null;
    const { words, answers, today, review } = stats.data;
    const series = daily.data?.series ?? [];
    const goalDone = today.goalProgress >= 1;
    const firstName = user.name.split(' ')[0];
    const remaining = Math.max(0, today.goal - today.correct);
    const weekDelta = weekOverWeek(series);
    return (<div className="mx-auto max-w-5xl space-y-10">
      <header className="text-center">
        <h1 className="word-display text-[32px] leading-[1.15] font-semibold tracking-tight sm:text-[44px]">
          {greeting()}, {firstName} — прогресс <em className="font-normal italic">одним взглядом</em>
        </h1>
        <p className="text-soft mx-auto mt-3 max-w-lg text-[14px] leading-relaxed">
          {words.encountered === 0
            ? 'Соберите первый пулл — это займёт пару минут.'
            : goalDone
                ? 'Дневная цель выполнена. Всё, что дальше, — сверх плана.'
                : `До цели осталось ${plural(remaining, 'слово', 'слова', 'слов')}.`}
        </p>
      </header>

      <section className="rounded-[28px] px-5 py-6 sm:px-8 sm:py-8" style={{ background: 'var(--dash-hero)', color: 'var(--dash-hero-ink)' }}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] uppercase" style={{ color: 'var(--dash-hero-muted)' }}>
              Сегодня
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="word-display text-[64px] leading-none font-semibold tracking-tight sm:text-[80px]">
                {today.correct}
              </p>
              <p className="mb-1.5 text-[24px] font-medium tabular-nums sm:mb-2 sm:text-[28px]" style={{ color: 'var(--dash-hero-muted)' }}>
                /{today.goal}
              </p>
              {goalDone ? <span className="mb-3 text-[13px] font-medium text-[#7dffb3]">цель ↗</span> : null}
            </div>
            <p className="mt-3 text-[13px]" style={{ color: 'var(--dash-hero-muted)' }}>
              {today.attempts === 0
            ? 'пока без ответов'
            : `${plural(today.attempts, 'ответ', 'ответа', 'ответов')} · ${formatDuration(today.timeMs)}`}
              {weekDelta ? ` · ${weekDelta}` : ''}
            </p>
          </div>

          <Link to="/practice" className="inline-flex h-14 shrink-0 items-center justify-center rounded-2xl bg-white px-8 text-[16px] font-medium text-[#141414] transition-opacity hover:opacity-90 active:scale-[0.98]">
            Заниматься
          </Link>
        </div>

        <div className="mt-8">
          {daily.loading && series.length === 0 ? (<div className="flex h-[160px] items-center justify-center text-[13px] text-white/35">Загрузка</div>) : (<AreaChart tone="hero" height={160} points={series.map((point) => ({ label: formatDayKey(point.day), value: point.attempts }))} formatValue={(value) => plural(value, 'ответ', 'ответа', 'ответов')} emptyLabel="здесь появится кривая занятий"/>)}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <ColorTile tone="a" value={formatNumber(review.dueNow)} delta={review.dueNow > 0 ? `${formatNumber(review.dueTomorrow)} завтра` : undefined} caption="слов ждут повторения сегодня"/>
        <ColorTile tone="b" value={String(user.dailyStreak)} delta={user.longestStreak > user.dailyStreak ? `рекорд ${user.longestStreak}` : user.dailyStreak > 0 ? 'рекорд держится' : undefined} caption="дней серии занятий подряд"/>
        <ColorTile tone="c" value={formatPercent(answers.accuracy)} delta={answers.attempts > 0 ? plural(answers.attempts, 'ответ', 'ответа', 'ответов') : undefined} caption="точных ответов за всё время"/>
        <ColorTile tone="d" value={formatNumber(words.learned)} delta={`${formatPercent(words.coverage)} словаря`} caption="слов уже в активном запасе"/>
      </section>

      <p className="text-center">
        <Link to="/stats" className="text-faint hover:text-ink text-[13px] transition-colors">
          вся статистика
        </Link>
      </p>
    </div>);
}
function ColorTile({ tone, value, delta, caption, }: {
    tone: 'a' | 'b' | 'c' | 'd';
    value: string;
    delta?: string;
    caption: string;
}) {
    return (<div className="flex min-h-[200px] flex-col justify-between rounded-[28px] px-6 py-6 sm:min-h-[240px]" style={{ background: `var(--dash-${tone})`, color: `var(--dash-${tone}-ink)` }}>
      <div>
        <p className="word-display text-[48px] leading-none font-semibold tracking-tight sm:text-[56px]">{value}</p>
        {delta ? <p className="mt-3 text-[13px] font-medium opacity-70">{delta}</p> : null}
      </div>
      <p className="mt-8 max-w-[11rem] text-[13px] leading-snug lowercase opacity-80">{caption}</p>
    </div>);
}
function weekOverWeek(series: DailyPoint[]): string | undefined {
    if (series.length < 8)
        return undefined;
    const last = series.slice(-7).reduce((sum, point) => sum + point.attempts, 0);
    const prev = series.slice(-14, -7).reduce((sum, point) => sum + point.attempts, 0);
    if (prev === 0 && last === 0)
        return undefined;
    if (prev === 0)
        return 'больше, чем неделю назад';
    const change = Math.round(((last - prev) / prev) * 100);
    if (change === 0)
        return 'как на прошлой неделе';
    return change > 0 ? `+${change}% к прошлой неделе` : `${change}% к прошлой неделе`;
}
function greeting(): string {
    const hour = new Date().getHours();
    if (hour < 5)
        return 'Доброй ночи';
    if (hour < 12)
        return 'Доброе утро';
    if (hour < 18)
        return 'Добрый день';
    return 'Добрый вечер';
}
