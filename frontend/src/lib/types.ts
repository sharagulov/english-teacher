export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type PracticeMode = 'classic' | 'reverse' | 'choice' | 'listening' | 'sprint' | 'weak' | 'srs' | 'mixed';

export type WordStatus = 'new' | 'learning' | 'review' | 'mastered' | 'leech';

export type MatchType = 'exact' | 'alternative' | 'typo' | 'wrong';

export type HintKind = 'length' | 'gloss' | 'letter' | 'choices';

export interface LevelProgress {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForLevel: number;
  progress: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  coins: number;
  xp: number;
  level: number;
  totalDelta: number;
  dailyStreak: number;
  longestStreak: number;
  streakFreezes: number;
  dailyGoalWords: number;
  cefrLevel: CefrLevel;
  typoTolerance: boolean;
  soundEnabled: boolean;
  autoAdvance: boolean;
  showTranscript: boolean;
  timezoneOffset: number;
  createdAt: string;
  progress: LevelProgress;
}

export interface Question {
  wordId: number;
  prompt: string;
  level: CefrLevel;
  partOfSpeech: string | null;
  transcription: string | null;
  direction: 'en_ru' | 'ru_en' | 'audio_en';
  choices?: string[];
  answerLength: number;
  attemptsSoFar: number;
  isRetry: boolean;
}

export interface PoolState {
  pool: {
    id: string;
    mode: PracticeMode;
    size: number;
    ordinal: number;
    status: string;
    correctCount: number;
    wrongCount: number;
    coinsEarned: number;
    xpEarned: number;
  };
  progress: { solved: number; total: number; remaining: number };
  question: Question | null;
}

export interface Achievement {
  code: string;
  title: string;
  description: string;
  category: string;
  threshold: number;
  metric: string;
  coins: number;
  xp: number;
  unlockedAt?: string | null;
}

export interface AnswerResult {
  isCorrect: boolean;
  matchType: MatchType;
  correctAnswer: string;
  allAnswers: string[];
  matched: string | null;
  reward: { coins: number; xp: number; breakdown: { label: string; value: string }[] };
  sessionStreak: number;
  wordProgress: { status: WordStatus; strength: number; timesSeen: number; timesCorrect: number; timesWrong: number };
  balance: { coins: number; xp: number; level: number; leveledUp: boolean };
  poolCompleted: boolean;
  poolSummary?: {
    size: number;
    correct: number;
    wrong: number;
    accuracy: number;
    coins: number;
    xp: number;
    durationMs: number;
  };
  achievements: Pick<Achievement, 'code' | 'title' | 'description' | 'coins' | 'xp'>[];
  dailyGoal: { reached: boolean; justCompleted: boolean; correct: number; goal: number };
  word: { text: string; gloss: string | null; senses: { sense: string; translations: string[] }[]; level: CefrLevel };
}

export interface PracticeOverview {
  levels: CefrLevel[];
  availability: {
    newWords: number;
    due: number;
    weak: number;
    total: number;
    modeMultipliers: Record<PracticeMode, number>;
  };
  activePool: PoolState | null;
  modes: { mode: PracticeMode; label: string; unlockLevel: number; unlocked: boolean }[];
  topics: { topic: string; count: number }[];
  hints: { kind: HintKind; label: string; cost: number }[];
}

export interface StatsOverview {
  user: User;
  words: {
    encountered: number;
    learning: number;
    review: number;
    mastered: number;
    leech: number;
    learned: number;
    dictionaryTotal: number;
    coverage: number;
  };
  answers: {
    attempts: number;
    correct: number;
    wrong: number;
    accuracy: number;
    avgResponseMs: number;
    totalTimeMs: number;
    bestWordStreak: number;
  };
  pools: { completed: number; perfect: number };
  today: {
    day: string;
    correct: number;
    attempts: number;
    newWords: number;
    coins: number;
    xp: number;
    timeMs: number;
    goal: number;
    goalProgress: number;
  };
  review: { dueNow: number; dueTomorrow: number; dueWeek: number };
  ai: { submissions: number };
  economy: { earned: number; spent: number; balance: number };
}

export interface DailyPoint {
  day: string;
  attempts: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
  newWords: number;
  learned: number;
  mastered: number;
  coins: number;
  xp: number;
  timeMs: number;
  aiTasks: number;
  poolsDone: number;
}

export interface WordRow {
  wordId: number;
  text: string;
  translations: string[];
  level: CefrLevel;
  partOfSpeech: string | null;
  topic: string | null;
  gloss: string | null;
  timesSeen: number;
  timesCorrect: number;
  timesWrong: number;
  accuracy: number | null;
  currentStreak: number;
  bestStreak: number;
  strength: number;
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  status: WordStatus;
  avgResponseMs: number;
  hintsUsed: number;
  lastSeenAt: string | null;
  dueAt: string;
  isFavorite: boolean;
  isIgnored: boolean;
}

export interface Breakdown {
  byLevel: ({ level: CefrLevel; total: number } & Record<WordStatus, number>)[];
  byMode: { mode: PracticeMode; attempts: number; correct: number; accuracy: number | null; avgResponseMs: number }[];
  byMatchType: { matchType: MatchType; count: number }[];
  byTopic: { topic: string; attempts: number; correct: number; accuracy: number | null }[];
  byHour: { hour: number; attempts: number; correct: number }[];
}

export interface DictionaryWord {
  id: number;
  text: string;
  translations: string[];
  level: CefrLevel;
  partOfSpeech: string | null;
  topic: string | null;
  gloss: string | null;
  transcription: string | null;
  frequencyRank: number | null;
  progress: {
    status: WordStatus;
    strength: number;
    timesSeen: number;
    timesWrong: number;
    isFavorite: boolean;
    isIgnored: boolean;
  } | null;
}

export interface WordDetail {
  word: {
    id: number;
    text: string;
    translations: string[];
    level: CefrLevel;
    partOfSpeech: string | null;
    topic: string | null;
    gloss: string | null;
    senses: { sense: string; translations: string[] }[];
    transcription: string | null;
    audioUrl: string | null;
    example: string | null;
    frequencyRank: number | null;
    license: string | null;
    enriched: boolean;
  };
  progress: WordRow | null;
  recentAttempts: {
    createdAt: string;
    given: string;
    isCorrect: boolean;
    matchType: MatchType;
    responseMs: number;
    mode: string;
  }[];
}

export type AiTaskType =
  | 'sentence_en_ru'
  | 'sentence_ru_en'
  | 'grammar_quiz'
  | 'cloze'
  | 'listening'
  | 'writing'
  | 'word_deep_dive';

export interface AiMeta {
  enabled: boolean;
  model: string | null;
  types: { type: AiTaskType; label: string; description: string }[];
  grammarTopics: Record<string, string[]>;
  scenarios: { code: string; title: string; description: string }[];
}

export interface AiTask {
  id: string;
  type: AiTaskType;
  level: CefrLevel;
  topic: string | null;
  label: string;
  payload: {
    sentence?: string;
    hint?: string;
    keyWords?: string[];
    direction?: 'en_ru' | 'ru_en';
    question?: string;
    options?: string[];
    translation?: string;
    prompt?: string;
    promptRu?: string;
    minWords?: number;
    checklist?: string[];
    wordCount?: number;
    word?: string;
    summary?: string;
    senses?: { meaning: string; example: string; exampleRu: string }[];
    collocations?: string[];
    confusedWith?: string[];
    mnemonic?: string;
  };
}

export interface AiResult {
  score: number;
  isCorrect: boolean;
  verdict: string;
  errors: { fragment: string; problem: string; fix: string }[];
  better: string;
  praise: string;
  reference: Record<string, unknown>;
  reward: { coins: number; xp: number };
  balance: { coins: number; xp: number; level: number; leveledUp: boolean };
  achievements: Pick<Achievement, 'code' | 'title' | 'description' | 'coins' | 'xp'>[];
}

export interface ShopItem {
  code: string;
  title: string;
  description: string;
  price: number;
  consumable: boolean;
  maxQuantity?: number;
  requiresLevel?: number;
  quantity: number;
  canBuy: boolean;
  reason: string | null;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  correction: { correction: string | null; tip: string | null } | null;
  createdAt: string;
}
