import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { RatingPoints } from './RatingPoints';
import { formatNumber } from '../lib/format';
import { CHAT_DISABLED_HINT, CHAT_ENABLED } from '../lib/features';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import { Toasts } from './Toasts';
import { cx } from './ui';

const NAV: {
  to: string;
  label: string;
  end?: boolean;
  disabled?: boolean;
  title?: string;
}[] = [
  { to: '/', label: 'Обзор', end: true },
  { to: '/practice', label: 'Слова' },
  { to: '/ai', label: 'Задания ИИ' },
  { to: '/chat', label: 'Диалог', disabled: !CHAT_ENABLED, title: CHAT_DISABLED_HINT },
  { to: '/dictionary', label: 'Словарь' },
  { to: '/stats', label: 'Статистика' },
  { to: '/rewards', label: 'Награды' },
  { to: '/profile', label: 'Профиль' },
];

function FlameIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5s3.5 3 3.5 6a3.5 3.5 0 1 1-7 0c0-1.2.6-2.2 1.2-3 .2 1 .8 1.6 1.4 1.6.8 0 1.2-.7.9-2-.2-1-.5-1.8-1-2.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Layout() {
  const user = useAuth((state) => state.user);
  const progress = user?.progress;
  const location = useLocation();

  // На экране тренировки навигация мешает сосредоточиться, поэтому скрываем её.
  const focusMode = location.pathname.startsWith('/practice/session');

  return (
    <div className="bg-surface flex min-h-dvh flex-col">
      {!focusMode ? (
        <header className="border-line bg-surface/85 sticky top-0 z-30 border-b backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
            <NavLink to="/" className="word-display text-ink shrink-0 text-[19px] font-semibold tracking-tight">
              Lexio
            </NavLink>

            <nav className="scrollbar-none -mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={item.title}
                  aria-disabled={item.disabled || undefined}
                  className={({ isActive }) =>
                    cx(
                      'rounded-lg px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150',
                      item.disabled
                        ? isActive
                          ? 'bg-sunken text-faint opacity-60'
                          : 'text-faint opacity-45 hover:opacity-60'
                        : isActive
                          ? 'bg-sunken text-ink'
                          : 'text-soft hover:text-ink',
                    )
                  }
                >
                  {item.label}
                  {item.disabled ? <span className="sr-only"> — {item.title}</span> : null}
                </NavLink>
              ))}
            </nav>

            {user ? (
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className="text-soft hidden items-center gap-1 text-[13px] font-medium tabular-nums sm:flex"
                  title="Дневная серия"
                >
                  <FlameIcon />
                  {user.dailyStreak}
                </span>
                <RatingPoints
                  amount={user.points}
                  iconSize={13}
                  iconClassName="text-accent"
                  valueClassName="text-[13px] font-medium text-ink"
                />
                {progress ? (
                  <NavLink
                    to="/rewards"
                    className="border-line hover:border-line-strong hidden items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition-colors sm:flex"
                    title={
                      progress.isMax
                        ? 'Максимальный уровень'
                        : `${formatNumber(progress.pointsIntoLevel)} / ${formatNumber(progress.pointsForLevel)} очков до следующего уровня`
                    }
                  >
                    <span className="text-faint">ур.</span>
                    <span className="text-ink font-semibold tabular-nums">{progress.level}</span>
                    {progress.isMax ? (
                      <span className="text-faint">макс.</span>
                    ) : (
                      <span className="bg-sunken relative h-1 w-8 overflow-hidden rounded-full">
                        <span
                          className="bg-accent absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${progress.progress * 100}%` }}
                        />
                      </span>
                    )}
                  </NavLink>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
      ) : null}

      <main className={cx('flex-1', focusMode ? '' : 'mx-auto w-full max-w-6xl px-4 py-8 sm:px-6')}>
        <Outlet />
      </main>

      {!focusMode ? <Footer /> : null}
      <Toasts />
    </div>
  );
}

function Footer() {
  const theme = useUi((state) => state.theme);
  const setTheme = useUi((state) => state.setTheme);
  const unlockedThemes = useUi((state) => state.unlockedThemes);

  return (
    <footer className="border-line mt-8 border-t">
      <div className="text-faint mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-[12px] sm:px-6">
        <p className="max-w-xl leading-relaxed">
          Словарь собран из открытых источников: переводы — Викисловарь через{' '}
          <a
            href="https://www.wikdict.com/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink underline underline-offset-2"
          >
            WikDict
          </a>{' '}
          (CC BY-SA), уровни — CEFR-J и Octanove, частотность — google-10000-english.
        </p>
        <div className="flex items-center gap-1">
          {(['light', 'paper', 'night'] as const).map((option) => {
            const locked = !unlockedThemes.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => setTheme(option)}
                title={locked ? 'Оформление открывается уровнем рейтинга' : undefined}
                className={cx(
                  'rounded-md px-2 py-1 transition-colors',
                  theme === option ? 'bg-sunken text-ink' : 'hover:text-ink',
                  locked && 'opacity-45',
                )}
              >
                {{ light: 'Светлая', paper: 'Бумага', night: 'Ночь' }[option]}
              </button>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
