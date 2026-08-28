import { useEffect, useState } from 'react';
import { Button, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { CefrLevel } from '../lib/types';
import { useAuth } from '../store/auth';

const LEVELS: { value: CefrLevel; label: string }[] = [
  { value: 'A1', label: 'A1 — начальный' },
  { value: 'A2', label: 'A2 — базовый' },
  { value: 'B1', label: 'B1 — средний' },
  { value: 'B2', label: 'B2 — выше среднего' },
  { value: 'C1', label: 'C1 — продвинутый' },
  { value: 'C2', label: 'C2 — свободный' },
];

export function Auth() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [cefrLevel, setCefrLevel] = useState<CefrLevel>('A2');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<number | null>(null);

  const login = useAuth((state) => state.login);
  const register = useAuth((state) => state.register);

  useEffect(() => {
    api
      .health()
      .then((health) => setWords(health.words))
      .catch(() => setWords(null));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register({ email, password, name, cefrLevel });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось выполнить вход');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-9 text-center">
          <h1 className="word-display text-ink text-[40px] font-semibold">Lexio</h1>
          <p className="text-soft mt-2 text-[13px] leading-relaxed">
            Тренажёр английского: интервальное повторение словаря
            <br />
            и задания от искусственного интеллекта.
          </p>
        </div>

        <div className="border-line bg-sunken mb-5 flex rounded-xl border p-0.5">
          {(['login', 'register'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setMode(option);
                setError(null);
              }}
              className={
                'flex-1 rounded-[10px] py-1.5 text-[13px] font-medium transition-colors ' +
                (mode === option ? 'bg-raised text-ink shadow-sm' : 'text-soft hover:text-ink')
              }
            >
              {option === 'login' ? 'Вход' : 'Регистрация'}
            </button>
          ))}
        </div>

        <form
          className="space-y-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === 'register' ? (
            <Input
              label="Как к вам обращаться"
              name="name"
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
              required
            />
          ) : null}

          <Input
            label="Почта"
            name="email"
            type="email"
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <Input
            label="Пароль"
            name="password"
            type="password"
            value={password}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(event) => setPassword(event.target.value)}
            hint={mode === 'register' ? 'Не короче 8 символов' : undefined}
            required
          />

          {mode === 'register' ? (
            <Select
              label="Ваш текущий уровень"
              name="cefrLevel"
              value={cefrLevel}
              onChange={(event) => setCefrLevel(event.target.value as CefrLevel)}
            >
              {LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </Select>
          ) : null}

          {error ? <p className="text-danger text-[13px]">{error}</p> : null}

          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {mode === 'login' ? 'Войти' : 'Начать заниматься'}
          </Button>
        </form>

        {words != null ? (
          <p className="text-faint mt-6 text-center text-[12px]">
            В словаре {words.toLocaleString('ru-RU')} слов с уровнями A1–C2
          </p>
        ) : (
          <p className="text-faint mt-6 text-center text-[12px]">Проверьте, запущен ли сервер на порту 4000</p>
        )}
      </div>
    </div>
  );
}
