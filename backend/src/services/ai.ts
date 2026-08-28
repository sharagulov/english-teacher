/**
 * ИИ-тренажёры: генерация заданий, проверка ответов и диалог с репетитором.
 *
 * Задания персонализированы: в них подмешиваются слова, на которых пользователь
 * ошибается чаще всего, поэтому практика речи одновременно закрепляет словарь.
 */
import { prisma } from '../db.js';
import { todayKey } from '../lib/day.js';
import { CHAT_TURN_REWARD, levelProgress, type LevelProgress } from '../lib/economy.js';
import {
  AI_TASK_LABELS,
  GRAMMAR_TOPICS,
  SCHEMAS,
  TUTOR_SYSTEM,
  ask,
  chatReplySchema,
  clozeSchema,
  grammarQuizSchema,
  gradingSchema,
  sentenceTaskSchema,
  wordDeepDiveSchema,
  writingPromptSchema,
  type AiTaskType,
} from '../lib/ai.js';
import { matchAnswer, parseStringArray } from '../lib/text.js';
import { awardPoints, bumpDailyStat, grantAchievements, registerDailyActivity, type UnlockedAchievement } from './progress.js';

/** Слова, которые стоит закрепить: чаще всего проваленные и просроченные. */
async function weakWords(userId: string, limit = 8): Promise<string[]> {
  const rows = await prisma.userWord.findMany({
    where: { userId, isIgnored: false, timesWrong: { gt: 0 } },
    orderBy: [{ timesWrong: 'desc' }, { strength: 'asc' }],
    take: limit,
    include: { word: { select: { text: true } } },
  });

  if (rows.length > 0) return rows.map((r) => r.word.text);

  // У новичка ошибок ещё нет — берём слова, которые он вообще видел.
  const seen = await prisma.userWord.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
    take: limit,
    include: { word: { select: { text: true } } },
  });
  return seen.map((r) => r.word.text);
}

async function userContext(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { cefrLevel: true, timezoneOffset: true, name: true },
  });
  return user;
}

export interface GenerateTaskInput {
  userId: string;
  type: AiTaskType;
  topic?: string;
  level?: string;
  wordId?: number;
}

export interface GeneratedTask {
  id: string;
  type: AiTaskType;
  level: string;
  topic: string | null;
  label: string;
  /** Содержимое, безопасное для отправки клиенту (без правильных ответов, где это важно). */
  payload: Record<string, unknown>;
}

/** Создаёт задание и сохраняет его вместе с эталонным ответом. */
export async function generateTask(input: GenerateTaskInput): Promise<GeneratedTask> {
  const user = await userContext(input.userId);
  const level = input.level ?? user.cefrLevel;
  const focus = await weakWords(input.userId);
  const focusHint = focus.length > 0 ? `Постарайся задействовать некоторые из этих слов: ${focus.join(', ')}.` : '';

  let payload: Record<string, unknown>;
  let clientPayload: Record<string, unknown>;
  let topic: string | null = input.topic ?? null;
  let usedWordIds: number[] = [];

  switch (input.type) {
    case 'sentence_en_ru':
    case 'sentence_ru_en': {
      const toRussian = input.type === 'sentence_en_ru';
      const task = await ask(
        {
          system: TUTOR_SYSTEM,
          user:
            `Составь одно предложение для перевода ${toRussian ? 'с английского на русский' : 'с русского на английский'}. ` +
            `Уровень студента: ${level} по шкале CEFR. Предложение должно быть естественным, из живой речи, длиной 8–16 слов. ` +
            (topic ? `Тема: ${topic}. ` : '') +
            focusHint +
            `\n\nВерни: sentence — предложение на ${toRussian ? 'английском' : 'русском'} языке; ` +
            `referenceTranslation — образцовый перевод на ${toRussian ? 'русский' : 'английский'}; ` +
            `hint — короткая подсказка по-русски о грамматике или лексике этого предложения; ` +
            `keyWords — 2–4 ключевых слова, на которые стоит обратить внимание.`,
          responseFormat: SCHEMAS.sentence,
        },
        sentenceTaskSchema,
      );

      payload = { ...task };
      clientPayload = { sentence: task.sentence, hint: task.hint, keyWords: task.keyWords, direction: toRussian ? 'en_ru' : 'ru_en' };
      break;
    }

    case 'grammar_quiz': {
      const pool = GRAMMAR_TOPICS[level] ?? GRAMMAR_TOPICS['B1']!;
      topic = input.topic ?? pool[Math.floor(Math.random() * pool.length)]!;

      const task = await ask(
        {
          system: TUTOR_SYSTEM,
          user:
            `Составь один вопрос с четырьмя вариантами ответа по теме «${topic}» для уровня ${level}. ` +
            `Вопрос — это английское предложение с пропуском или выбором формы. Неверные варианты должны быть правдоподобными. ` +
            `explanation — понятное объяснение по-русски, почему верен именно этот вариант и чем плохи остальные. ` +
            `correctIndex — индекс верного варианта с нуля.`,
          responseFormat: SCHEMAS.grammarQuiz,
          temperature: 0.9,
        },
        grammarQuizSchema,
      );

      if (task.correctIndex >= task.options.length) task.correctIndex = 0;

      payload = { ...task };
      clientPayload = { question: task.question, options: task.options, topic: task.topic };
      break;
    }

    case 'cloze': {
      const words = await prisma.userWord.findMany({
        where: { userId: input.userId, isIgnored: false },
        orderBy: [{ timesWrong: 'desc' }, { strength: 'asc' }],
        take: 12,
        include: { word: true },
      });

      const target = words[Math.floor(Math.random() * Math.max(words.length, 1))]?.word;
      usedWordIds = target ? [target.id] : [];

      const task = await ask(
        {
          system: TUTOR_SYSTEM,
          user:
            `Составь предложение уровня ${level} с одним пропуском, обозначенным как «___». ` +
            (target
              ? `В пропуск должно подходить слово «${target.text}» (перевод: ${parseStringArray(target.translations).join(', ')}). `
              : `Выбери подходящее по уровню слово сам. `) +
            `Контекст должен однозначно указывать на нужное слово. ` +
            `answer — слово в правильной форме; acceptable — другие допустимые формы или синонимы; ` +
            `translation — перевод всего предложения на русский; explanation — почему подходит именно это слово.`,
          responseFormat: SCHEMAS.cloze,
        },
        clozeSchema,
      );

      payload = { ...task };
      clientPayload = { sentence: task.sentence, translation: task.translation };
      break;
    }

    case 'listening': {
      const task = await ask(
        {
          system: TUTOR_SYSTEM,
          user:
            `Составь одну английскую фразу уровня ${level} для диктанта на слух: 6–14 слов, ` +
            `естественная разговорная речь, без редких имён собственных. ` +
            (topic ? `Тема: ${topic}. ` : '') +
            focusHint +
            `\n\nsentence — сама фраза на английском; referenceTranslation — её перевод на русский; ` +
            `hint — подсказка по-русски о том, что в ней сложно услышать; keyWords — 2–3 ключевых слова.`,
          responseFormat: SCHEMAS.sentence,
        },
        sentenceTaskSchema,
      );

      payload = { ...task };
      // Текст фразы клиенту не отдаём: его должен произнести синтезатор речи.
      clientPayload = { hint: task.hint, wordCount: task.sentence.split(/\s+/).length };
      break;
    }

    case 'writing': {
      const task = await ask(
        {
          system: TUTOR_SYSTEM,
          user:
            `Придумай короткое письменное задание для студента уровня ${level}. ` +
            (topic ? `Тема: ${topic}. ` : '') +
            `prompt — формулировка задания на английском; promptRu — то же по-русски; ` +
            `minWords — минимальный объём (от 40 до 120 слов); ` +
            `checklist — 3–4 пункта по-русски, что обязательно нужно использовать в тексте.`,
          responseFormat: SCHEMAS.writingPrompt,
        },
        writingPromptSchema,
      );

      payload = { ...task };
      clientPayload = { ...task };
      break;
    }

    case 'word_deep_dive': {
      if (!input.wordId) {
        throw Object.assign(new Error('Для разбора слова нужно указать wordId'), { statusCode: 400 });
      }
      const word = await prisma.word.findUniqueOrThrow({ where: { id: input.wordId } });
      usedWordIds = [word.id];

      const task = await ask(
        {
          system: TUTOR_SYSTEM,
          user:
            `Разбери английское слово «${word.text}» для студента уровня ${level}. ` +
            `Известные переводы: ${parseStringArray(word.translations).join(', ')}. ` +
            `summary — краткое объяснение смысла по-русски (1–2 предложения); ` +
            `senses — до трёх основных значений, каждое с примером на английском и его переводом; ` +
            `collocations — 4–6 частых сочетаний с этим словом; ` +
            `confusedWith — слова, с которыми его путают, с краткой пометкой чем отличаются; ` +
            `mnemonic — способ запомнить слово, привязанный к русскому языку.`,
          responseFormat: SCHEMAS.wordDeepDive,
          temperature: 0.7,
        },
        wordDeepDiveSchema,
      );

      payload = { ...task, word: word.text };
      clientPayload = { ...task, word: word.text };
      break;
    }
  }

  const task = await prisma.aiTask.create({
    data: {
      userId: input.userId,
      type: input.type,
      level,
      topic,
      payload: JSON.stringify(payload),
      usedWordIds: usedWordIds.length > 0 ? JSON.stringify(usedWordIds) : null,
    },
  });

  return {
    id: task.id,
    type: input.type,
    level,
    topic,
    label: AI_TASK_LABELS[input.type],
    payload: clientPayload,
  };
}

// ─────────────────────────────── Проверка ответа ───────────────────────────────

/** Награда за задание ИИ зависит от качества ответа. Письменная работа дороже: она объёмнее. */
function aiReward(score: number, type: AiTaskType): number {
  const base = type === 'writing' ? 2 : 1;
  if (score >= 90) return 50 * base;
  if (score >= 70) return 32 * base;
  if (score >= 50) return 18 * base;
  return 5;
}

export interface SubmitTaskResult {
  score: number;
  isCorrect: boolean;
  verdict: string;
  errors: { fragment: string; problem: string; fix: string }[];
  better: string;
  praise: string;
  /** Эталон и пояснение раскрываются только после ответа. */
  reference: Record<string, unknown>;
  reward: { points: number };
  rating: { points: number; level: number; leveledUp: boolean; freezesGranted: number; progress: LevelProgress };
  achievements: UnlockedAchievement[];
}

export async function submitTask(userId: string, taskId: string, answer: string): Promise<SubmitTaskResult> {
  const task = await prisma.aiTask.findFirstOrThrow({ where: { id: taskId, userId } });
  const payload = JSON.parse(task.payload) as Record<string, unknown>;
  const type = task.type as AiTaskType;

  let score = 0;
  let verdict = '';
  let errors: SubmitTaskResult['errors'] = [];
  let better = '';
  let praise = '';
  let reference: Record<string, unknown> = {};

  if (type === 'grammar_quiz') {
    // Тест с вариантами проверяется локально — обращение к модели не нужно.
    const correctIndex = Number(payload['correctIndex']);
    const chosen = Number.parseInt(answer, 10);
    const isRight = chosen === correctIndex;
    score = isRight ? 100 : 0;
    verdict = isRight ? 'Верно.' : 'Неверный вариант.';
    better = String((payload['options'] as string[])[correctIndex] ?? '');
    reference = { correctIndex, explanation: payload['explanation'], options: payload['options'] };
    praise = isRight ? 'Тема освоена — можно двигаться дальше.' : '';
  } else if (type === 'cloze') {
    // Пропущенное слово: сначала пробуем точное сравнение, к модели не обращаемся.
    const accepted = [String(payload['answer']), ...((payload['acceptable'] as string[]) ?? [])];
    const match = matchAnswer(answer, accepted, { english: true, allowTypos: true });
    score = match.isCorrect ? (match.matchType === 'typo' ? 80 : 100) : 0;
    verdict = match.isCorrect
      ? match.matchType === 'typo'
        ? 'Верно, но с опечаткой.'
        : 'Верно.'
      : 'Не подходит по смыслу или форме.';
    better = String(payload['answer']);
    reference = { answer: payload['answer'], translation: payload['translation'], explanation: payload['explanation'] };
  } else {
    // Свободный ответ оценивает модель.
    const description = (() => {
      switch (type) {
        case 'sentence_en_ru':
          return `Оригинал на английском: «${payload['sentence']}». Образцовый перевод на русский: «${payload['referenceTranslation']}». Студент перевёл на русский: «${answer}».`;
        case 'sentence_ru_en':
          return `Оригинал на русском: «${payload['sentence']}». Образцовый перевод на английский: «${payload['referenceTranslation']}». Студент перевёл на английский: «${answer}».`;
        case 'listening':
          return `Прозвучала английская фраза: «${payload['sentence']}». Студент записал на слух: «${answer}».`;
        case 'writing':
          return `Задание: «${payload['prompt']}». Требования: ${(payload['checklist'] as string[])?.join('; ')}. Текст студента: «${answer}».`;
        default:
          return `Задание: ${JSON.stringify(payload)}. Ответ студента: «${answer}».`;
      }
    })();

    const grading = await ask(
      {
        system: TUTOR_SYSTEM,
        user:
          `Проверь работу студента уровня ${task.level}.\n\n${description}\n\n` +
          `Оценивай смысл и грамматику, а не буквальное совпадение слов: если мысль передана верно и язык корректен — это высокий балл. ` +
          `Мелкие опечатки не считай ошибкой, но упомяни их.\n` +
          `score — оценка 0–100; isAcceptable — можно ли считать ответ принятым (обычно score ≥ 70); ` +
          `verdict — вывод в одном предложении по-русски; errors — список конкретных ошибок ` +
          `(fragment — фрагмент ответа студента, problem — что не так, fix — как правильно); ` +
          `better — улучшенный вариант ответа целиком; praise — что студент сделал хорошо.`,
        responseFormat: SCHEMAS.grading,
        temperature: 0.3,
        maxTokens: 1200,
      },
      gradingSchema,
    );

    score = grading.score;
    verdict = grading.verdict;
    errors = grading.errors;
    better = grading.better;
    praise = grading.praise;
    reference = {
      sentence: payload['sentence'] ?? null,
      referenceTranslation: payload['referenceTranslation'] ?? null,
      hint: payload['hint'] ?? null,
    };
  }

  const isCorrect = score >= 70;
  const reward = aiReward(score, type);

  await prisma.aiSubmission.create({
    data: {
      taskId: task.id,
      userId,
      answer,
      score,
      isCorrect,
      feedback: JSON.stringify({ verdict, errors, better, praise }),
      points: reward,
    },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezoneOffset: true } });
  const today = todayKey(user.timezoneOffset);

  await registerDailyActivity(userId);
  const award = await awardPoints(userId, { points: reward, reason: `ai:${type}`, meta: { taskId: task.id, score } });
  await bumpDailyStat(userId, today, { aiTasks: 1, points: reward });

  // Ошибка в задании — сигнал, что задействованные слова стоит повторить раньше.
  if (!isCorrect && task.usedWordIds) {
    const ids = JSON.parse(task.usedWordIds) as number[];
    if (Array.isArray(ids) && ids.length > 0) {
      await prisma.userWord.updateMany({
        where: { userId, wordId: { in: ids } },
        data: { dueAt: new Date() },
      });
    }
  }

  return {
    score,
    isCorrect,
    verdict,
    errors,
    better,
    praise,
    reference,
    reward: { points: reward },
    rating: {
      points: award.total,
      level: award.level,
      leveledUp: award.leveledUp,
      freezesGranted: award.freezesGranted,
      progress: levelProgress(award.total),
    },
    achievements: await grantAchievements(userId),
  };
}

/** Текст фразы для диктанта — отдаётся отдельно, чтобы озвучить его в браузере. */
export async function getListeningText(userId: string, taskId: string): Promise<string> {
  const task = await prisma.aiTask.findFirstOrThrow({ where: { id: taskId, userId, type: 'listening' } });
  const payload = JSON.parse(task.payload) as { sentence?: string };
  return payload.sentence ?? '';
}

// ─────────────────────────────── Диалог с репетитором ───────────────────────────────

export const CHAT_SCENARIOS: { code: string; title: string; description: string }[] = [
  { code: 'free', title: 'Свободная беседа', description: 'Разговор на любую тему в вашем темпе.' },
  { code: 'cafe', title: 'В кафе', description: 'Заказ, уточнения, просьбы и мелкие проблемы.' },
  { code: 'airport', title: 'Аэропорт', description: 'Регистрация, досмотр, задержка рейса.' },
  { code: 'interview', title: 'Собеседование', description: 'Рассказ о себе, опыте и мотивации.' },
  { code: 'doctor', title: 'У врача', description: 'Симптомы, назначения, запись на приём.' },
  { code: 'hotel', title: 'Отель', description: 'Заселение, просьбы, жалобы, выезд.' },
  { code: 'smalltalk', title: 'Светская беседа', description: 'Погода, выходные, планы, лёгкие темы.' },
];

export async function createChatSession(userId: string, scenario: string, title?: string) {
  const user = await userContext(userId);
  const preset = CHAT_SCENARIOS.find((s) => s.code === scenario) ?? CHAT_SCENARIOS[0]!;

  return prisma.chatSession.create({
    data: {
      userId,
      scenario: preset.code,
      level: user.cefrLevel,
      title: title?.trim() || preset.title,
    },
  });
}

export interface ChatTurnResult {
  reply: string;
  correction: string | null;
  tip: string | null;
  reward: { points: number };
}

/** Один ход диалога: ответ репетитора плюс разбор реплики студента. */
export async function chatTurn(userId: string, sessionId: string, message: string): Promise<ChatTurnResult> {
  const session = await prisma.chatSession.findFirstOrThrow({
    where: { id: sessionId, userId },
    include: { messages: { orderBy: { id: 'asc' }, take: 30 } },
  });

  const preset = CHAT_SCENARIOS.find((s) => s.code === session.scenario) ?? CHAT_SCENARIOS[0]!;

  const history = session.messages
    .map((m) => `${m.role === 'user' ? 'Студент' : 'Преподаватель'}: ${m.content}`)
    .join('\n');

  const result = await ask(
    {
      system:
        TUTOR_SYSTEM +
        ` Сейчас ты ведёшь диалог на английском в роли собеседника по сценарию «${preset.title}» (${preset.description}). ` +
        `Уровень студента — ${session.level}: подбирай лексику и длину реплик под него.`,
      user:
        (history ? `История диалога:\n${history}\n\n` : '') +
        `Новая реплика студента: «${message}»\n\n` +
        `reply — твоя следующая реплика на английском (1–3 предложения, всегда заканчивай вопросом, чтобы диалог продолжался); ` +
        `corrected — были ли в реплике студента ошибки; ` +
        `correction — если ошибки были, приведи исправленный вариант его реплики и кратко по-русски объясни правки, иначе пустая строка; ` +
        `tip — короткий совет по-русски, как сказать это естественнее, иначе пустая строка.`,
      responseFormat: SCHEMAS.chatReply,
      temperature: 0.9,
    },
    chatReplySchema,
  );

  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: 'user',
      content: message,
      correction: result.corrected ? JSON.stringify({ correction: result.correction, tip: result.tip }) : null,
    },
  });
  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: 'assistant', content: result.reply },
  });
  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

  // Разговорная практика тоже приносит награду — иначе ей не будут пользоваться.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezoneOffset: true } });
  await registerDailyActivity(userId);
  await awardPoints(userId, { points: CHAT_TURN_REWARD, reason: 'ai:chat', meta: { sessionId } });
  await bumpDailyStat(userId, todayKey(user.timezoneOffset), { points: CHAT_TURN_REWARD });

  return {
    reply: result.reply,
    correction: result.corrected && result.correction ? result.correction : null,
    tip: result.tip || null,
    reward: { points: CHAT_TURN_REWARD },
  };
}
