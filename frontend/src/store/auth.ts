import { create } from 'zustand';
import { api, getToken, setToken } from '../lib/api';
import type { CefrLevel, User } from '../lib/types';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'guest';
  error: string | null;
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; name: string; cefrLevel: CefrLevel }) => Promise<void>;
  logout: () => void;
  /** Локальное обновление после начислений — без лишнего запроса. */
  patchUser: (patch: Partial<User>) => void;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<User>) => Promise<void>;
}

const timezoneOffset = -new Date().getTimezoneOffset();

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',
  error: null,

  restore: async () => {
    if (!getToken()) {
      set({ status: 'guest', user: null });
      return;
    }
    try {
      const { user } = await api.auth.me();
      set({ user, status: 'authenticated', error: null });
    } catch {
      setToken(null);
      set({ status: 'guest', user: null });
    }
  },

  login: async (email, password) => {
    set({ error: null });
    const { token, user } = await api.auth.login({ email, password });
    setToken(token);
    set({ user, status: 'authenticated' });
  },

  register: async (input) => {
    set({ error: null });
    const { token, user } = await api.auth.register({ ...input, timezoneOffset });
    setToken(token);
    set({ user, status: 'authenticated' });
  },

  logout: () => {
    setToken(null);
    set({ user: null, status: 'guest' });
  },

  patchUser: (patch) => {
    const current = get().user;
    if (!current) return;
    set({ user: { ...current, ...patch } });
  },

  refresh: async () => {
    try {
      const { user } = await api.auth.me();
      set({ user });
    } catch {
      // молча: обновление баланса не критично для работы интерфейса
    }
  },

  updateSettings: async (patch) => {
    const { user } = await api.auth.update(patch);
    set({ user });
  },
}));
