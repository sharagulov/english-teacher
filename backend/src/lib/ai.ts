/**
 * Обёртка над OpenAI API.
 *
 * Все задания и проверки запрашиваются со строгой JSON-схемой: модель обязана
 * вернуть структуру заданного вида, поэтому ответ можно разбирать без
 * эвристик и «угадывания» формата.
 */
import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../env.js';
import { recordAiUsage } from '../services/ai-usage.js';

let client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!env.aiEnabled) {
    throw Object.assign(new Error('ИИ-функции недоступны: не задан OPENAI_API_KEY в backend/.env'), {
      statusCode: 503,
    });
  }
  client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
  });
  return client;
}

export const AI_TASK_TYPES = [
  'sentence_en_ru',
  'sentence_ru_en',
  'grammar_quiz',
  'cloze',
  'listening',
  'writing',
  'word_deep_dive',
] as const;

export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const AI_TASK_LABELS: Record<AiTaskType, string> = {
  sentence_en_ru: 'Перевод с английского',
  sentence_ru_en: 'Перевод на английский',
  grammar_quiz: 'Грамматика',
  cloze: 'Пропущенное слово',
  listening: 'Диктант на слух',
  writing: 'Письменная речь',
  word_deep_dive: 'Разбор слова',
};

export const AI_TASK_DESCRIPTIONS: Record<AiTaskType, string> = {
  sentence_en_ru: 'ИИ даёт английское предложение — переведите его на русский по смыслу.',
  sentence_ru_en: 'ИИ даёт русское предложение — переведите его на английский.',
  grammar_quiz: 'Вопрос с вариантами ответа на конкретную грамматическую тему.',
  cloze: 'Предложение с пропуском: подберите подходящее слово.',
  listening: 'Прослушайте фразу и запишите её текстом.',
  writing: 'Короткое письменное задание с подробным разбором ошибок.',
  word_deep_dive: 'Полный разбор слова: значения, сочетания, примеры и мнемоника.',
};

/** Грамматические темы по уровням — для выбора в интерфейсе и подсказки модели. */
export const GRAMMAR_TOPICS: Record<string, string[]> = {
  A1: ['to be', 'Present Simple', 'артикли a/an/the', 'множественное число', 'личные местоимения', 'there is / there are', 'can / can’t', 'предлоги места'],
  A2: ['Past Simple', 'Present Continuous', 'сравнительная и превосходная степень', 'исчисляемые и неисчисляемые', 'going to', 'наречия частотности', 'модальные should / must', 'притяжательный падеж'],
  B1: ['Present Perfect', 'Past Continuous', 'первое и второе условное', 'пассивный залог', 'used to', 'относительные придаточные', 'косвенная речь', 'герундий и инфинитив'],
  B2: ['Present Perfect Continuous', 'Past Perfect', 'третье условное', 'смешанные условные', 'модальные для предположений', 'причастные обороты', 'инверсия', 'фразовые глаголы'],
  C1: ['нереальные условия', 'сослагательное наклонение', 'продвинутая инверсия', 'эмфатические конструкции', 'сложные пассивные формы', 'дискурсивные маркеры', 'коллокации', 'нюансы артиклей'],
  C2: ['стилистическая инверсия', 'эллипсис', 'тонкие оттенки модальности', 'идиоматика', 'регистр и стиль', 'нестандартные согласования'],
};

// ─────────────────────────────── Схемы ответов ───────────────────────────────

/**
 * Схема для structured outputs. OpenAI требует, чтобы у каждого объекта были
 * `additionalProperties: false` и все ключи перечислены в `required`.
 */
function schema(name: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name,
      strict: true,
      schema: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

const str = { type: 'string' } as const;
const strArray = { type: 'array', items: { type: 'string' } } as const;

export const SCHEMAS = {
  sentence: schema(
    'sentence_task',
    {
      sentence: str,
      hint: str,
      referenceTranslation: str,
      keyWords: strArray,
    },
    ['sentence', 'hint', 'referenceTranslation', 'keyWords'],
  ),

  grammarQuiz: schema(
    'grammar_quiz',
    {
      question: str,
      options: strArray,
      correctIndex: { type: 'integer' },
      explanation: str,
      topic: str,
    },
    ['question', 'options', 'correctIndex', 'explanation', 'topic'],
  ),

  cloze: schema(
    'cloze_task',
    {
      sentence: str,
      answer: str,
      acceptable: strArray,
      translation: str,
      explanation: str,
    },
    ['sentence', 'answer', 'acceptable', 'translation', 'explanation'],
  ),

  writingPrompt: schema(
    'writing_prompt',
    {
      prompt: str,
      promptRu: str,
      minWords: { type: 'integer' },
      checklist: strArray,
    },
    ['prompt', 'promptRu', 'minWords', 'checklist'],
  ),

  grading: schema(
    'grading',
    {
      score: { type: 'integer' },
      verdict: str,
      isAcceptable: { type: 'boolean' },
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: { fragment: str, problem: str, fix: str },
          required: ['fragment', 'problem', 'fix'],
          additionalProperties: false,
        },
      },
      better: str,
      praise: str,
    },
    ['score', 'verdict', 'isAcceptable', 'errors', 'better', 'praise'],
  ),

  wordDeepDive: schema(
    'word_deep_dive',
    {
      summary: str,
      senses: {
        type: 'array',
        items: {
          type: 'object',
          properties: { meaning: str, example: str, exampleRu: str },
          required: ['meaning', 'example', 'exampleRu'],
          additionalProperties: false,
        },
      },
      collocations: strArray,
      confusedWith: strArray,
      mnemonic: str,
    },
    ['summary', 'senses', 'collocations', 'confusedWith', 'mnemonic'],
  ),

  wordExamples: schema(
    'word_examples',
    {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            word: str,
            examples: {
              type: 'array',
              items: {
                type: 'object',
                properties: { en: str, ru: str },
                required: ['en', 'ru'],
                additionalProperties: false,
              },
            },
          },
          required: ['word', 'examples'],
          additionalProperties: false,
        },
      },
    },
    ['items'],
  ),

  chatReply: schema(
    'chat_reply',
    {
      reply: str,
      correction: str,
      corrected: { type: 'boolean' },
      tip: str,
    },
    ['reply', 'correction', 'corrected', 'tip'],
  ),
} as const;

// ─────────────────────────── Разбор ответов модели ───────────────────────────

export const sentenceTaskSchema = z.object({
  sentence: z.string(),
  hint: z.string(),
  referenceTranslation: z.string(),
  keyWords: z.array(z.string()),
});

export const grammarQuizSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).max(6),
  correctIndex: z.number().int().min(0),
  explanation: z.string(),
  topic: z.string(),
});

export const clozeSchema = z.object({
  sentence: z.string(),
  answer: z.string(),
  acceptable: z.array(z.string()),
  translation: z.string(),
  explanation: z.string(),
});

export const writingPromptSchema = z.object({
  prompt: z.string(),
  promptRu: z.string(),
  minWords: z.number().int().min(20).max(400),
  checklist: z.array(z.string()),
});

export const gradingSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.string(),
  isAcceptable: z.boolean(),
  errors: z.array(z.object({ fragment: z.string(), problem: z.string(), fix: z.string() })),
  better: z.string(),
  praise: z.string(),
});

export const wordDeepDiveSchema = z.object({
  summary: z.string(),
  senses: z.array(z.object({ meaning: z.string(), example: z.string(), exampleRu: z.string() })),
  collocations: z.array(z.string()),
  confusedWith: z.array(z.string()),
  mnemonic: z.string(),
});

export const wordExamplesSchema = z.object({
  items: z.array(
    z.object({
      word: z.string(),
      examples: z.array(z.object({ en: z.string(), ru: z.string() })),
    }),
  ),
});

export const chatReplySchema = z.object({
  reply: z.string(),
  correction: z.string(),
  corrected: z.boolean(),
  tip: z.string(),
});

// ─────────────────────────────── Вызов модели ───────────────────────────────

export interface AskOptions {
  system: string;
  user: string;
  responseFormat: ReturnType<typeof schema>;
  temperature?: number;
  maxTokens?: number;
  /** Если задан — расход токенов пишется в профиль пользователя. */
  userId?: string;
}

/** Единая точка вызова модели с разбором JSON-ответа заданной схемой. */
export async function ask<T>(options: AskOptions, parser: z.ZodType<T>): Promise<T> {
  const completion = await openai().chat.completions.create({
    model: env.OPENAI_MODEL,
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 900,
    response_format: options.responseFormat,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw Object.assign(new Error('Модель вернула пустой ответ'), { statusCode: 502 });
  }

  if (options.userId && completion.usage) {
    void recordAiUsage(options.userId, {
      inputTokens: completion.usage.prompt_tokens ?? 0,
      outputTokens: completion.usage.completion_tokens ?? 0,
    }).catch(() => {
      // Сбой учёта не должен ломать ответ пользователю.
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw Object.assign(new Error('Модель вернула некорректный JSON'), { statusCode: 502 });
  }

  const parsed = parser.safeParse(json);
  if (!parsed.success) {
    throw Object.assign(new Error(`Ответ модели не соответствует ожидаемой структуре: ${parsed.error.issues[0]?.message}`), {
      statusCode: 502,
    });
  }
  return parsed.data;
}

/** Базовая роль модели: репетитор, объясняющий по-русски. */
export const TUTOR_SYSTEM =
  'Ты — опытный преподаватель английского языка для русскоговорящих студентов. ' +
  'Ты объясняешь кратко, по делу и доброжелательно. Все пояснения и комментарии пиши по-русски, ' +
  'а примеры на английском — естественным, живым языком без канцелярита. ' +
  'Никогда не выдумывай грамматические правила. Отвечай строго в требуемом формате JSON.';
