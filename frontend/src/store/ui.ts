import { create } from 'zustand';

export type Theme = 'light' | 'paper' | 'night';

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: 'neutral' | 'success' | 'danger' | 'reward';
}

interface UiState {
  theme: Theme;
  /** Светлая тема доступна всегда, остальные открываются уровнем рейтинга. */
  unlockedThemes: Theme[];
  setUnlockedThemes: (themes: Theme[]) => void;
  setTheme: (theme: Theme) => void;
  toasts: Toast[];
  notify: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

/**
 * С какого уровня доступно оформление. Те же пороги заданы на сервере
 * (backend/src/lib/economy.ts) — здесь они нужны, чтобы тема применялась
 * сразу после входа, не дожидаясь ответа сервера.
 */
export const THEME_UNLOCK_LEVEL: Record<Theme, number> = {
  light: 1,
  paper: 5,
  night: 12,
};

/** Какие оформления открыты на этом уровне рейтинга. */
export function themesForLevel(level: number): Theme[] {
  return (Object.keys(THEME_UNLOCK_LEVEL) as Theme[]).filter((theme) => level >= THEME_UNLOCK_LEVEL[theme]);
}

const THEME_KEY = 'lexio.theme';

function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme === 'light' ? '' : theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'night' ? '#0f1113' : theme === 'paper' ? '#fbf9f4' : '#ffffff');
}

const stored = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'light';
applyTheme(stored);

let nextToastId = 1;

export const useUi = create<UiState>((set, get) => ({
  theme: stored,
  unlockedThemes: ['light'],

  setUnlockedThemes: (themes) => {
    const unlocked: Theme[] = ['light', ...themes.filter((theme) => theme !== 'light')];
    set({ unlockedThemes: unlocked });

    // Тема могла остаться в localStorage от другого аккаунта.
    if (!unlocked.includes(get().theme)) get().setTheme('light');
  },

  setTheme: (theme) => {
    if (!get().unlockedThemes.includes(theme)) {
      get().notify({
        title: 'Оформление ещё закрыто',
        description: `Откроется на ${THEME_UNLOCK_LEVEL[theme]} уровне рейтинга`,
        tone: 'neutral',
      });
      return;
    }
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },

  toasts: [],

  notify: (toast) => {
    const id = nextToastId++;
    set({ toasts: [...get().toasts, { ...toast, id }] });
    setTimeout(() => get().dismiss(id), toast.tone === 'reward' ? 3200 : 4200);
  },

  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
