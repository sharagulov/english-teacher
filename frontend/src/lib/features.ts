/**
 * Диалог с AI-репетитором.
 *
 * Маршруты: /chat, /chat/:sessionId
 * UI: frontend/src/pages/AiChat.tsx
 * API: backend/src/routes/ai.ts (chats, messages)
 *
 * Сейчас выключен — пункт «Диалог» в навигации виден, но приглушён.
 * Чтобы включить: поставить true и пересобрать фронт.
 */
export const CHAT_ENABLED = false;

export const CHAT_DISABLED_HINT = 'Раздел в разработке';
