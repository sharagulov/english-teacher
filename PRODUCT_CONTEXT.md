# PRODUCT_CONTEXT — Lexio

Документ описывает существующий продукт **Lexio** по фактам из репозитория (код, README, конфигурации). Цель — дать AI-агенту контекст перед изменениями.

---

## 1. Product Overview

**Lexio** — веб-тренажёр английского языка с интервальным повторением словаря, несколькими режимами перевода слов и заданиями от OpenAI (упражнения + диалог с репетитором).

**Проблема:** систематическое запоминание английской лексики с адаптивной выдачей слов, отслеживанием прогресса и мотивацией через рейтинг/уровни.

**Что может пользователь:**
- регистрироваться и входить по email/паролю;
- тренировать слова в пуллах (8 режимов);
- просматривать словарь, статистику, достижения, награды за уровень;
- выполнять AI-задания и вести диалог с AI-репетитором (при наличии `OPENAI_API_KEY`);
- настраивать профиль (CEFR-уровень, дневная цель, озвучка, тема оформления и др.).

**Основной пользователь:** в интерфейсе и текстах используется русский язык; продукт ориентирован на изучающих английский. **Точная целевая аудитория (возраст, B2C/B2B) — не установлено из кода.**

**Словарь:** ~9000 слов импортируется из открытых источников (WikDict, CEFR-J, Octanove, google-10000-english, Tatoeba) — см. `README.md`, `backend/src/tools/import-dictionary.ts`.

---

## 2. Core Product Concept

Центральная сущность — **слово (`Word`) и персональный прогресс по нему (`UserWord`)**. Пользователь не «проходит уроки», а собирает **пуллы** — наборы слов (в UI: 10/15/20/30/40; API допускает 5–50) — и отвечает на вопросы по одному слову за раз. Верный ответ убирает слово из пулла; неверный оставляет его до следующего круга.

Вокруг пуллов работает **SM-2-подобная модель памяти** (`backend/src/lib/srs.ts`): интервалы, сила, статусы (`new` → `learning` → `review` → `mastered` / `leech`), приоритет ошибочных слов.

Параллельно идёт **рейтинг** — единая валюта очков (`User.points`), задающая уровень 1–1000 (`backend/src/lib/economy.ts`). Очки начисляются за ответы, пуллы, серии, достижения; **частично тратятся** на платную подсказку в режиме «Выбор варианта» (`spendPoints` в `backend/src/services/progress.ts`).

**Основной сценарий:** зайти → собрать пулл → пройти сессию → получить очки и обновление SRS → посмотреть прогресс на Dashboard/Stats.

**Результат для пользователя:** растущий словарный запас с измеримым прогрессом (статистика, уровень, достижения, повторения по сроку).

---

## 3. Main User Flows

### Регистрация и вход

**Entry point:** `/` (гость видит `Auth` без layout-навигации).

**Flow:** выбор «Вход» / «Регистрация» → email + пароль (+ имя и CEFR при регистрации) → JWT в `localStorage` → загрузка профиля.

**Result:** аутентифицированный пользователь, redirect в основное приложение с `Layout`.

**Code areas:** `frontend/src/pages/Auth.tsx`, `frontend/src/store/auth.ts`, `frontend/src/lib/api.ts`, `backend/src/routes/auth.ts`, `backend/src/plugins/auth.ts`.

---

### Обзор дня (Dashboard)

**Entry point:** `/` (index route).

**Flow:** загрузка `stats/overview` и `stats/daily` → показ дневной цели, серии, слов на повторение, ссылки «Заниматься».

**Result:** сводка активности и CTA в тренировку.

**Code areas:** `frontend/src/pages/Dashboard.tsx`, `backend/src/routes/stats.ts`.

---

### Тренировка слов (пулл)

**Entry point:** `/practice`.

**Flow:** выбор режима, размера пулла, фильтров (уровни CEFR, темы) → `POST /practice/pools` → переход на `/practice/session/:poolId` → ответы через `POST .../answer` → завершение пулла или abandon.

**Result:** обновлённые `UserWord`, начисленные очки, возможные достижения, статистика за день.

**Code areas:** `frontend/src/pages/Practice.tsx`, `frontend/src/pages/Session.tsx`, `backend/src/routes/practice.ts`, `backend/src/services/practice.ts`, `backend/src/services/progress.ts`, `backend/src/lib/srs.ts`, `backend/src/lib/economy.ts`, `backend/src/lib/text.ts`.

---

### Просмотр словаря

**Entry point:** `/dictionary`.

**Flow:** поиск/фильтры → список слов → деталь слова, примеры, избранное/игнор, dislike, сброс прогресса, добавление своего слова.

**Result:** просмотр и управление отношением к словам без обязательной сессии.

**Code areas:** `frontend/src/pages/Dictionary.tsx`, `backend/src/routes/words.ts`, `backend/src/services/enrich.ts`, `backend/src/services/examples.ts`.

---

### Статистика и история

**Entry point:** `/stats`.

**Flow:** overview, графики по дням, таблица слов, breakdown по уровням, история попыток и транзакций, AI usage.

**Result:** аналитика прогресса и рейтинга.

**Code areas:** `frontend/src/pages/Stats.tsx`, `frontend/src/components/charts.tsx`, `backend/src/routes/stats.ts`.

---

### Награды за уровень

**Entry point:** `/rewards` (также ссылка из header на уровень).

**Flow:** список наград (режимы, темы, заморозки серии) с признаком `unlocked` по текущему уровню.

**Result:** понимание, что откроется следующим уровнем.

**Code areas:** `frontend/src/pages/Rewards.tsx`, `backend/src/routes/rewards.ts`, `backend/src/lib/economy.ts` (`levelRewards`).

---

### AI-задания

**Entry point:** `/ai`.

**Flow:** выбор типа задания → генерация через OpenAI → ответ пользователя → проверка (локально или через модель) → очки и feedback.

**Result:** практика грамматики/перевода/письма вне word-pool.

**Code areas:** `frontend/src/pages/AiTasks.tsx`, `backend/src/routes/ai.ts`, `backend/src/services/ai.ts`, `backend/src/lib/ai.ts`.

**Ограничение:** без `OPENAI_API_KEY` AI отключён (`env.aiEnabled`).

---

### Диалог с AI-репетитором

**Entry point:** `/chat`, `/chat/:sessionId`.

**Flow:** выбор сценария → создание сессии → обмен сообщениями с разбором ошибок → очки за ход.

**Result:** разговорная практика с коррекцией.

**Code areas:** `frontend/src/pages/AiChat.tsx`, `backend/src/routes/ai.ts`, `backend/src/services/ai.ts`.

---

### Настройки профиля

**Entry point:** `/profile`.

**Flow:** изменение имени, CEFR, дневной цели, typo tolerance, звука, темы (если разблокирована), timezone offset.

**Result:** обновлённый `User` через `PATCH /auth/me`.

**Code areas:** `frontend/src/pages/Profile.tsx`, `backend/src/routes/auth.ts`.

---

## 4. Domain Model

### User

- **Смысл:** аккаунт и агрегированный прогресс (рейтинг, серии, настройки, AI usage counters).
- **Ключевые поля:** `id` (cuid), `email`, `points`, `level`, `cefrLevel`, `dailyStreak`, `streakFreezes`, `dailyGoalWords`, настройки UI.
- **Связи:** `UserWord`, `Pool`, `Attempt`, `Transaction`, `UserAchievement`, `DailyStat`, AI/chat сущности.
- **Код:** `backend/prisma/schema.prisma`, `frontend/src/lib/types.ts` (`User`).

### Word

- **Смысл:** запись в словаре (общая или пользовательская при `ownerId`).
- **Ключевые поля:** `text`, `translations` (JSON), `level` (A1–C2), `partOfSpeech`, `frequencyRank`, `isFunctionWord`.
- **Связи:** `UserWord`, `PoolItem`, `Attempt`, `WordExample`.
- **Код:** `backend/prisma/schema.prisma`, импорт `backend/src/tools/import-dictionary.ts`.

### UserWord

- **Смысл:** персональный SRS-прогресс по слову.
- **Ключевые поля:** счётчики (`timesSeen/Correct/Wrong`), `strength`, `ease`, `intervalDays`, `status`, `dueAt`, `dislikeLevel`, флаги favorite/ignored.
- **Связи:** `User` + `Word`, уникальность `(userId, wordId)`.
- **Код:** `backend/prisma/schema.prisma`, обновление в `backend/src/lib/srs.ts`, `backend/src/services/practice.ts`.

### Pool / PoolItem

- **Смысл:** сессия тренировки — набор слов в конкретном режиме.
- **Ключевые поля:** `mode`, `size`, `status` (active/completed/abandoned), счётчики, `choicesJson` / `hintHidden` для режима choice.
- **Связи:** `User`, слова через `PoolItem`, `Attempt`.
- **Код:** `backend/prisma/schema.prisma`, `backend/src/services/practice.ts`.

### Attempt

- **Смысл:** одна попытка ответа (аудит + undo).
- **Ключевые поля:** `question`, `expected`, `given`, `isCorrect`, `matchType`, `responseMs`, `points`, `undoSnapshot`.
- **Код:** `backend/prisma/schema.prisma`, создание в `practice.ts`.

### Transaction

- **Смысл:** история изменений рейтинга.
- **Ключевые поля:** `amount` (положительные начисления; отрицательные — траты на подсказки), `reason`, `balanceAfter`.
- **Код:** `backend/prisma/schema.prisma`, `backend/src/services/progress.ts`.

### UserAchievement

- **Смысл:** факт получения достижения (определения — в коде).
- **Ключевые поля:** `code`, `unlockedAt`.
- **Код:** `backend/src/lib/achievements.ts`, `backend/src/services/progress.ts` (`grantAchievements`).

### DailyStat

- **Смысл:** агрегат активности за календарный день пользователя (`YYYY-MM-DD` по `timezoneOffset`).
- **Код:** `backend/src/lib/day.ts`, `backend/src/services/progress.ts`.

### AiTask / AiSubmission / ChatSession / ChatMessage

- **Смысл:** сгенерированные AI-задания, ответы пользователя, диалоги с репетитором.
- **Код:** `backend/prisma/schema.prisma`, `backend/src/services/ai.ts`.

---

## 5. Application Architecture

| Слой | Реализация |
|------|------------|
| **Frontend** | React 19 + Vite 8 + TypeScript |
| **Routing** | `react-router-dom` v7, `BrowserRouter`, lazy-loaded pages (`frontend/src/App.tsx`) |
| **State** | Zustand: `useAuth` (user/session), `useUi` (theme, toasts). Страничные данные — локальный state + `useAsync` |
| **Data fetching** | Единый `fetch`-клиент `frontend/src/lib/api.ts`; без React Query/SWR |
| **API layer** | REST под `/api/*`; dev-прокси Vite → `:4000` |
| **Backend** | Fastify 5, маршруты в `backend/src/routes/*`, бизнес-логика в `backend/src/services/*`, pure rules в `backend/src/lib/*` |
| **Validation** | Zod на backend (route bodies/queries); frontend — минимальная клиентская проверка в формах |
| **Auth** | JWT (`@fastify/jwt`, 30d), Bearer в `Authorization`, hook `app.authenticate` |
| **Persistence** | SQLite через Prisma 7 + `@prisma/adapter-better-sqlite3`; схема `backend/prisma/schema.prisma` |
| **Styling** | Tailwind CSS v4 (`@tailwindcss/vite`), семантические CSS-переменные в `frontend/src/index.css`, темы через `data-theme` |
| **Error handling** | Backend: centralized `setErrorHandler` в `index.ts`; frontend: `ApiError`, `ErrorNote`, toasts через `useUi` |
| **Production** | Backend отдаёт `frontend/dist` + SPA fallback (`backend/src/index.ts`) |

**Размещение бизнес-логики:** правила SRS/экономики/текста — `backend/src/lib/`; orchestration и DB — `backend/src/services/`; UI не дублирует расчёты наград.

---

## 6. Project Structure

```
english/                          # npm workspaces monorepo (lexio)
├── backend/
│   ├── prisma/schema.prisma      # Модель данных SQLite
│   ├── src/
│   │   ├── index.ts              # Fastify app, routes, static, errors
│   │   ├── routes/               # HTTP endpoints (auth, practice, words, stats, rewards, ai)
│   │   ├── services/             # Бизнес-оркестрация (practice, progress, ai, examples, enrich)
│   │   ├── lib/                  # Чистые правила: srs, economy, text, achievements, levels, ai
│   │   ├── plugins/auth.ts       # JWT middleware
│   │   ├── tools/                # Импорт словаря и примеров (CLI)
│   │   └── generated/prisma/     # Prisma client (генерируется)
│   └── scripts/                  # smoke, rating-curve, migrate-points
├── frontend/
│   └── src/
│       ├── pages/                # Экраны приложения (route targets)
│       ├── components/           # Layout, ui design system, charts, feature widgets
│       ├── store/                # Zustand: auth, ui
│       └── lib/                  # api, types, format, useAsync, speech
├── scripts/                      # deploy.sh, server-setup.sh (VPS)
├── deploy/                       # systemd unit, nginx example
└── .github/workflows/            # CI typecheck/build, deploy on release-server
```

---

## 7. Important Modules

| Путь | Назначение | Зависимости / потребители |
|------|------------|---------------------------|
| `backend/src/services/practice.ts` | Пуллы, отбор слов, ответы, undo, choice hint | lib/srs, economy, text, progress; routes/practice; Session.tsx |
| `backend/src/services/progress.ts` | Единая точка начисления/списания очков, daily stats, achievements | lib/economy, achievements; practice, ai, stats |
| `backend/src/lib/economy.ts` | Формулы наград, уровни 1–1000, unlock режимов/тем | practice, progress, rewards, frontend (косвенно через API) |
| `backend/src/lib/srs.ts` | SM-2 + приоритет ошибок | practice.ts |
| `backend/src/lib/text.ts` | Нормализация и сверка ответов (Levenshtein typo) | practice.ts |
| `backend/src/lib/achievements.ts` | Определения достижений (в коде, не в БД) | progress.ts |
| `frontend/src/lib/api.ts` | Все HTTP-вызовы, token storage | все pages, auth store |
| `frontend/src/store/auth.ts` | Сессия пользователя | App, Layout, Session, Profile |
| `frontend/src/components/ui.tsx` | Design system (Button, Input, Card, Loading, Modal…) | все pages |
| `frontend/src/pages/Session.tsx` | UX сессии пулла (самый сложный экран) | api.practice.* |
| `backend/prisma/schema.prisma` | Контракт данных | весь backend |

---

## 8. Existing Architectural Patterns

- **Backend routes:** тонкие — parse (Zod) → вызов service → JSON; `preHandler: app.authenticate` на защищённых роутах.
- **Ожидаемые ошибки:** `throw Object.assign(new Error('...'), { statusCode: 4xx })` в services.
- **Frontend pages:** `useAsync(loader)` для GET; мутации — локальный `useState` + `api.*` + `patchUser` / `notify`.
- **Типы API:** дублируются на frontend в `frontend/src/lib/types.ts` (не shared package).
- **Labels/constants:** `MODE_LABELS`, `PART_OF_SPEECH_LABELS` — `frontend/src/lib/format.ts`; unlock-уровни режимов — только backend `economy.ts`; unlock тем — **продублирован** в `frontend/src/store/ui.ts` и `backend/src/lib/economy.ts`.
- **Компоненты UI:** функциональные React, Tailwind через `cx()`, варианты через Record-мапы (`BUTTON_VARIANTS`).
- **Lazy routes:** тяжёлые страницы через `React.lazy` в `App.tsx`.
- **Локальное хранение:** JWT `lexio.token`, тема `lexio.theme`, excluded CEFR levels `lexio.practice.excludedLevels.{userId}`.
- **Комментарии в коде:** русский язык, объясняют «почему», не «что».

---

## 9. UI / UX Principles Already Present

- **Layout:** sticky header с горизонтальной nav (`Layout.tsx`), max-width `6xl`, footer с атрибуцией словаря и переключателем темы.
- **Focus mode:** на `/practice/session/*` header/footer скрыты для концентрации.
- **Navigation:** 8 пунктов — Обзор, Слова, Задания ИИ, Диалог, Словарь, Статистика, Награды, Профиль.
- **Header metrics:** дневная серия (flame), очки рейтинга, уровень с mini-progress bar.
- **Controls:** кастомные `Button`, `Input`, `Card`, `Badge`, `Stat`, `Progress`; иконки — `lucide-react`.
- **Feedback:** toasts (`useUi.notify`), inline `ErrorNote`, `Loading` с label.
- **Session UX:** фазы question/feedback; undo неверного ответа; choice hint за рейтинг; dislike слова; озвучка (`speech.ts`) в listening.
- **Themes:** `light` (default), `paper`, `night` — CSS variables, unlock by rating level.
- **Typography:** класс `word-display` для заголовков; русская локализация форматирования (`format.ts`, `plural`).
- **Responsive:** mobile-first Tailwind (`sm:`, скрытие части header на маленьких экранах).

---

## 10. Data Flow

### Аутентификация

```
Auth form → useAuth.login/register → api.auth.* → JWT → localStorage
→ restore() → api.auth.me → useAuth.user → App routes (guest vs authenticated)
```

### Тренировка (типичный ответ)

```
Session input → api.practice.answer
→ practice.submitAnswer (matchAnswer, applyAnswer, computeReward)
→ progress.awardPoints / grantAchievements / bumpDailyStat
→ JSON { result, state }
→ Session setState/pending → patchUser(rating) → notify(achievements)
```

### Загрузка страницы со списком

```
Page mount → useAsync(() => api.*) → setData/setError/setLoading → render Loading/ErrorNote/content
```

### Настройки профиля

```
Profile form → useAuth.updateSettings → api.auth.update → PATCH /auth/me → set user in store
```

**Отдельного global cache/server state на frontend нет** — после мутаций часто обновляют локально (`patchUser`, `setState`) или `reload()` через `useAsync`.

---

## 11. API and External Dependencies

### Backend API (prefix `/api`)

| Prefix | Назначение |
|--------|------------|
| `/auth` | register, login, me, PATCH settings |
| `/practice` | overview, pools CRUD, answer, undo, choice-hint, abandon |
| `/words` | dictionary list/detail, flags, dislike, reset, custom words, enrich |
| `/stats` | overview, daily, words, breakdown, attempts, transactions, achievements, pools, ai-usage |
| `/rewards` | level rewards list |
| `/ai` | tasks, submit, chats, messages, meta, history |
| `/health` | status, aiEnabled, word count, attribution |

### External services

| Сервис | Использование |
|--------|---------------|
| **OpenAI API** | Генерация AI-заданий, проверка свободных ответов, диалог, обогащение слов (`backend/src/services/ai.ts`, `enrich.ts`) |
| **Открытые словари/корпуса** | Одноразовый импорт в SQLite (не runtime API) |

### Architecturally significant libraries

| Library | Role |
|---------|------|
| Fastify + plugins | HTTP server, JWT, CORS, rate limit, static |
| Prisma + better-sqlite3 | ORM + SQLite |
| Zod | Env + request validation |
| bcryptjs | Password hashing |
| React + react-router-dom | SPA |
| Zustand | Global client state |
| Tailwind CSS v4 | Styling |
| lucide-react | Icons |
| OpenAI SDK | AI features |

---

## 12. Authentication and Permissions

- **Login/register:** email + password (min 8 chars), bcrypt hash.
- **Session:** JWT Bearer, 30 days, secret `JWT_SECRET`.
- **Storage:** `localStorage` key `lexio.token`.
- **Protected routes (API):** все `/api/*` кроме `/auth/register`, `/auth/login`, `/health` — через `app.authenticate`.
- **Protected routes (frontend):** `App.tsx` — guest видит только `Auth`; authenticated — все routes under `Layout`.
- **401 handling:** `SessionWatcher` → logout → redirect `/`.
- **Roles/permissions/admin:** **не установлено из кода** — единственный тип пользователя, RBAC отсутствует.

---

## 13. Product Invariants

- Каждый `UserWord` принадлежит ровно одному `(userId, wordId)`.
- Рейтинг пользователя изменяется через `awardPoints` / `spendPoints` / `subtractPoints` в `progress.ts` (не напрямую разрозненными update без Transaction).
- `User.level` пересчитывается из `User.points` функцией `levelFromPoints` — не задаётся произвольно.
- Пулл закрывается, когда все слова решены верно; неверный ответ не удаляет слово из пулла (до верного ответа).
- Словарные слова для тренировки — `Word.ownerId = null` и `isFunctionWord = false` (служебные слова исключены).
- Отбор слов для пользователя учитывает `User.cefrLevel` через `levelsUpTo()` — свой уровень и ниже + следующий.
- Достижения выдаются один раз (`UserAchievement` unique by `userId, code`); определения живут в коде.
- Дневная серия и «день» считаются по `User.timezoneOffset`, не по UTC сервера.
- Режимы тренировки блокируются по `User.level >= MODE_UNLOCK_LEVEL[mode]` (кроме classic/choice/srs — с 1 lvl).
- AI-функции не работают без `OPENAI_API_KEY` (`env.aiEnabled === false`).
- `User.id` (cuid) — стабильный идентификатор; все user-data cascade on delete.

---

## 14. Architectural Constraints

- Frontend **не вызывает fetch напрямую** — только через `frontend/src/lib/api.ts`.
- Backend **не кладёт бизнес-правила в routes** — routes делегируют services/lib.
- **Нет shared types package** — frontend types вручную синхронизированы с API responses.
- **SQLite ограничения:** enums и массивы хранятся как `String` / JSON-строки (см. комментарии в schema).
- **Schema changes:** через `prisma db push` (+ deploy backup), не через папку migrations в репозитории (**formal migrate history — не установлено из кода**).
- **Production deploy:** ветка `release-server`, скрипт `scripts/deploy.sh`; `.env` и `dev.db` на сервере не перезаписываются из git.
- **Компоненты UI** — из `components/ui.tsx`, не ad-hoc HTML-кнопки на новых экранах.
- **Модалки** — `Modal` из `ui.tsx` (role=dialog pattern).

---

## 15. Reuse Before Creation

Перед созданием нового:

| Нужно | Проверить |
|-------|-----------|
| HTTP-запрос | `frontend/src/lib/api.ts` — добавить метод в объект `api` |
| Тип ответа API | `frontend/src/lib/types.ts` |
| Кнопка / input / card | `frontend/src/components/ui.tsx` |
| Toast / уведомление | `useUi().notify` в `frontend/src/store/ui.ts` |
| Загрузка данных на странице | `frontend/src/lib/useAsync.ts` |
| Форматирование чисел/дат/режимов | `frontend/src/lib/format.ts` |
| Global user state | `frontend/src/store/auth.ts` |
| Начисление очков | `backend/src/services/progress.ts` — не писать raw `user.update({ points })` |
| Награда за ответ | `backend/src/lib/economy.ts` → `computeReward` |
| SRS update | `backend/src/lib/srs.ts` → `applyAnswer` |
| Сверка перевода | `backend/src/lib/text.ts` → `matchAnswer` |
| Достижение | `backend/src/lib/achievements.ts` + `grantAchievements` |
| Route + auth | паттерн в `backend/src/routes/*.ts` + `preHandler: app.authenticate` |
| График | `frontend/src/components/charts.tsx` |
| Layout / nav | `frontend/src/components/Layout.tsx` |

---

## 16. Sensitive / High-Impact Areas

| Область | Impact при изменении |
|---------|---------------------|
| `backend/prisma/schema.prisma` | Все данные пользователей; требует осторожного `db push` и бэкапа |
| `backend/src/services/progress.ts` | Рейтинг, транзакции, достижения — финансовая целостность продукта |
| `backend/src/lib/economy.ts` | Баланс прогресса, unlocks, стоимость подсказок |
| `backend/src/lib/srs.ts` | Алгоритм запоминания — ломает due dates и статусы слов |
| `backend/src/services/practice.ts` | Ядро тренировки; большой файл, много side effects |
| `frontend/src/lib/api.ts` | Контракт frontend↔backend для всего приложения |
| `frontend/src/store/auth.ts` | Сессия; ошибка → logout loops или stale user |
| `frontend/src/App.tsx` | Routing gate guest/authenticated |
| `backend/src/plugins/auth.ts` | Безопасность всех protected endpoints |
| `frontend/src/pages/Session.tsx` | Основной UX loop; регрессии сильно заметны |
| `scripts/deploy.sh` | Production availability; содержит backup перед schema push |

---

## 17. Known Technical Debt / Unclear Areas

| Проблема | Где | Почему помнить |
|----------|-----|----------------|
| README утверждает, что очки «не тратятся», но реализовано списание за choice hint | `README.md` vs `progress.spendPoints`, `Session.tsx` | Документация и UI-комментарии могут расходиться с кодом |
| Комментарий в `types.ts`: «очки только растут» — неверен для hint spend | `frontend/src/lib/types.ts` | Не полагаться на устаревшие комментарии |
| Unlock-уровни тем продублированы frontend/backend | `ui.ts`, `economy.ts` | Изменение порогов требует синхронизации двух файлов |
| Нет Prisma migrations в репо, только `db push` | `package.json`, deploy | Schema evolution без versioned migrations |
| Achievement definitions только в коде | `achievements.ts` | Удаление/переименование code ломает семантику старых записей |
| Frontend/backend types не shared | `types.ts` vs Prisma | Drift API ↔ UI возможен |
| `npm run db:reset` уничтожает БД | `backend/package.json` | Катастрофа на production |

---

## 18. Agent Working Rules

### Rules for AI agents

Before modifying the project:

1. Read this file.
2. Inspect the files directly related to the requested change.
3. Search for existing implementations of similar behavior.
4. Preserve current architecture unless explicitly asked to change it.
5. Prefer reuse over introducing new abstractions.
6. Keep the diff as small as reasonably possible.
7. Do not redesign unrelated parts of the product.
8. Do not invent business requirements.
9. Do not perform opportunistic refactoring.
10. Verify callers and dependencies before changing shared code.

The existing codebase is the primary source of truth.

If this document conflicts with the actual implementation, inspect the implementation and update this document if necessary.
