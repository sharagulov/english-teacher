import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { setUnauthorizedHandler } from './lib/api';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { useAuth } from './store/auth';
import { themesForLevel, useUi } from './store/ui';

// Разделы, не нужные на первом экране, загружаются по требованию —
// так первая отрисовка остаётся быстрой.
const Practice = lazy(() => import('./pages/Practice').then((m) => ({ default: m.Practice })));
const Session = lazy(() => import('./pages/Session').then((m) => ({ default: m.Session })));
const AiTasks = lazy(() => import('./pages/AiTasks').then((m) => ({ default: m.AiTasks })));
const AiChat = lazy(() => import('./pages/AiChat').then((m) => ({ default: m.AiChat })));
const Dictionary = lazy(() => import('./pages/Dictionary').then((m) => ({ default: m.Dictionary })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const Rewards = lazy(() => import('./pages/Rewards').then((m) => ({ default: m.Rewards })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));

/** Оформление открывается уровнем рейтинга, поэтому следим за уровнем. */
function ThemeUnlocker() {
  const level = useAuth((state) => state.user?.level ?? 1);
  const setUnlockedThemes = useUi((state) => state.setUnlockedThemes);

  useEffect(() => {
    setUnlockedThemes(themesForLevel(level));
  }, [level, setUnlockedThemes]);

  return null;
}

/** Перехватывает истёкшую сессию и возвращает на экран входа. */
function SessionWatcher() {
  const navigate = useNavigate();
  const logout = useAuth((state) => state.logout);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
      navigate('/', { replace: true });
    });
  }, [logout, navigate]);

  return null;
}

export function App() {
  const status = useAuth((state) => state.status);
  const restore = useAuth((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === 'loading') {
    return (
      <div className="bg-surface flex min-h-dvh items-center justify-center">
        <Loading label="Загружаем профиль" />
      </div>
    );
  }

  if (status === 'guest') {
    return (
      <BrowserRouter>
        <Auth />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <SessionWatcher />
      <ThemeUnlocker />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="practice" element={<Practice />} />
            <Route path="practice/session/:poolId" element={<Session />} />
            <Route path="ai" element={<AiTasks />} />
            <Route path="chat" element={<AiChat />} />
            <Route path="chat/:sessionId" element={<AiChat />} />
            <Route path="dictionary" element={<Dictionary />} />
            <Route path="stats" element={<Stats />} />
            <Route path="rewards" element={<Rewards />} />
            <Route path="profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
