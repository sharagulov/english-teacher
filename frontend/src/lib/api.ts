import type {
  AiMeta,
  AiResult,
  AiTask,
  AiTaskType,
  AiUsageOverview,
  AnswerResult,
  Breakdown,
  CefrLevel,
  ChatMessage,
  DailyPoint,
  DictionaryWord,
  PoolState,
  PracticeMode,
  PracticeOverview,
  RewardsOverview,
  StatsOverview,
  User,
  WordDetail,
  WordExample,
  WordRow,
  WordStatsSort,
} from './types';

const TOKEN_KEY = 'lexio.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Ошибка запроса с текстом, пригодным для показа пользователю. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Вызывается при истечении токена — интерфейс переводит на вход. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('Не удаётся связаться с сервером. Проверьте, запущен ли backend.', 0);
  }

  if (response.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError('Сессия истекла, войдите заново', 401);
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Ошибка запроса (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
};

export const api = {
  health: () => request<{ status: string; aiEnabled: boolean; words: number; attribution: string[] }>('GET', '/health'),

  auth: {
    register: (body: { email: string; password: string; name: string; cefrLevel: CefrLevel; timezoneOffset: number }) =>
      request<{ token: string; user: User }>('POST', '/auth/register', body),
    login: (body: { email: string; password: string }) =>
      request<{ token: string; user: User }>('POST', '/auth/login', body),
    me: () => request<{ user: User }>('GET', '/auth/me'),
    update: (body: Partial<Pick<User, 'name' | 'cefrLevel' | 'dailyGoalWords' | 'typoTolerance' | 'soundEnabled' | 'autoAdvance' | 'showTranscript' | 'timezoneOffset'>>) =>
      request<{ user: User }>('PATCH', '/auth/me', body),
  },

  practice: {
    overview: () => request<PracticeOverview>('GET', '/practice/overview'),
    createPool: (body: { mode: PracticeMode; size: number; levels?: CefrLevel[]; topics?: string[]; partsOfSpeech?: string[] }) =>
      request<PoolState>('POST', '/practice/pools', body),
    activePool: () => request<{ state: PoolState | null }>('GET', '/practice/pools/active'),
    pool: (id: string) => request<PoolState>('GET', `/practice/pools/${id}`),
    answer: (id: string, body: { wordId: number; answer: string; responseMs: number; hintsUsed: number; gaveUp?: boolean }) =>
      request<{ result: AnswerResult; state: PoolState }>('POST', `/practice/pools/${id}/answer`, body),
    undo: (id: string, body: { wordId: number }) =>
      request<{ state: PoolState; undo: { rating: Pick<User, 'points' | 'level' | 'progress'> } }>('POST', `/practice/pools/${id}/undo`, body),
    abandon: (id: string) => request<{ ok: boolean }>('POST', `/practice/pools/${id}/abandon`),
  },

  words: {
    list: (params: {
      search?: string;
      level?: CefrLevel;
      topic?: string;
      partOfSpeech?: string;
      onlyUnseen?: boolean;
      page?: number;
      perPage?: number;
    }) =>
      request<{ total: number; page: number; perPage: number; items: DictionaryWord[] }>(
        'GET',
        `/words${query(params)}`,
      ),
    detail: (id: number) => request<WordDetail>('GET', `/words/${id}`),
    examples: (id: number) => request<{ examples: WordExample[] }>('GET', `/words/${id}/examples`),
    enrich: (id: number) =>
      request<{ transcription: string | null; audioUrl: string | null; example: string | null; gloss: string | null; enriched: boolean }>(
        'POST',
        `/words/${id}/enrich`,
      ),
    setFlags: (id: number, body: { isFavorite?: boolean; isIgnored?: boolean }) =>
      request<unknown>('PATCH', `/words/${id}/flags`, body),
    dislike: (id: number, body?: { level?: number }) =>
      request<{ dislikeLevel: number }>('POST', `/words/${id}/dislike`, body ?? {}),
    reset: (id: number) => request<{ ok: boolean }>('POST', `/words/${id}/reset`),
    addCustom: (body: { text: string; translations: string[]; level: CefrLevel; partOfSpeech?: string; topic?: string; gloss?: string }) =>
      request<{ wordId: number }>('POST', '/words/custom', body),
    meta: () =>
      request<{ topics: { topic: string; count: number }[]; partsOfSpeech: { partOfSpeech: string; count: number }[] }>(
        'GET',
        '/words/meta/topics',
      ),
  },

  stats: {
    overview: () => request<StatsOverview>('GET', '/stats/overview'),
    daily: (days = 30) => request<{ series: DailyPoint[] }>('GET', `/stats/daily?days=${days}`),
    words: (params: {
      status?: string;
      level?: CefrLevel;
      search?: string;
      sort?: WordStatsSort;
      order?: 'asc' | 'desc';
      favorite?: boolean;
      page?: number;
      perPage?: number;
    }) => request<{ total: number; page: number; perPage: number; items: WordRow[] }>('GET', `/stats/words${query(params)}`),
    breakdown: () => request<Breakdown>('GET', '/stats/breakdown'),
    attempts: (params: { limit?: number; onlyWrong?: boolean }) =>
      request<{ items: Record<string, unknown>[] }>('GET', `/stats/attempts${query(params)}`),
    transactions: (limit = 50) =>
      request<{ items: { id: number; amount: number; reason: string; balanceAfter: number; createdAt: string }[] }>(
        'GET',
        `/stats/transactions?limit=${limit}`,
      ),
    achievements: () => request<{ items: (import('./types').Achievement)[] }>('GET', '/stats/achievements'),
    pools: (limit = 30) =>
      request<{
        items: {
          id: string;
          mode: PracticeMode;
          size: number;
          ordinal: number;
          status: string;
          correctCount: number;
          wrongCount: number;
          pointsEarned: number;
          durationMs: number;
          createdAt: string;
          completedAt: string | null;
        }[];
      }>('GET', `/stats/pools?limit=${limit}`),
    aiUsage: () => request<AiUsageOverview>('GET', '/stats/ai-usage'),
  },

  rewards: {
    list: () => request<RewardsOverview>('GET', '/rewards'),
  },

  ai: {
    meta: () => request<AiMeta>('GET', '/ai/meta'),
    createTask: (body: { type: AiTaskType; topic?: string; level?: CefrLevel; wordId?: number }) =>
      request<{ task: AiTask }>('POST', '/ai/tasks', body),
    submit: (id: string, answer: string) => request<{ result: AiResult }>('POST', `/ai/tasks/${id}/submit`, { answer }),
    audioText: (id: string) => request<{ text: string }>('GET', `/ai/tasks/${id}/audio-text`),
    history: (limit = 30) =>
      request<{
        items: {
          id: number;
          createdAt: string;
          score: number;
          isCorrect: boolean;
          answer: string;
          feedback: { verdict: string; better: string; praise: string; errors: { fragment: string; problem: string; fix: string }[] };
          points: number;
          type: AiTaskType;
          label: string;
          level: CefrLevel;
          topic: string | null;
        }[];
      }>('GET', `/ai/history?limit=${limit}`),
    chats: () =>
      request<{ items: { id: string; title: string; scenario: string; level: CefrLevel; messages: number; updatedAt: string }[] }>(
        'GET',
        '/ai/chats',
      ),
    createChat: (body: { scenario: string; title?: string }) =>
      request<{ session: { id: string; title: string; scenario: string; level: CefrLevel } }>('POST', '/ai/chats', body),
    chat: (id: string) =>
      request<{
        session: { id: string; title: string; scenario: string; level: CefrLevel };
        messages: ChatMessage[];
      }>('GET', `/ai/chats/${id}`),
    sendMessage: (id: string, message: string) =>
      request<{ result: { reply: string; correction: string | null; tip: string | null; reward: { points: number } } }>(
        'POST',
        `/ai/chats/${id}/messages`,
        { message },
      ),
    deleteChat: (id: string) => request<{ ok: boolean }>('DELETE', `/ai/chats/${id}`),
  },
};
