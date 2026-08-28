import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Kbd,
  Loading,
  PageHeader,
  SectionTitle,
  Spinner,
  cx,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatRelative, plural } from '../lib/format';
import { speak } from '../lib/speech';
import type { ChatMessage } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';

export function AiChat() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const patchUser = useAuth((state) => state.patchUser);
  const user = useAuth((state) => state.user);
  const notify = useUi((state) => state.notify);

  const meta = useAsync(() => api.ai.meta(), []);
  const chats = useAsync(() => api.ai.chats(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);

  // ─── Загрузка выбранного диалога ───
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setTitle('');
      return;
    }
    let alive = true;
    setLoadingChat(true);
    api.ai
      .chat(sessionId)
      .then((response) => {
        if (!alive) return;
        setMessages(response.messages);
        setTitle(response.session.title);
      })
      .catch((cause: unknown) => {
        if (alive) setFailure(cause instanceof ApiError ? cause.message : 'Диалог не найден');
      })
      .finally(() => {
        if (alive) setLoadingChat(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, waiting]);

  const startChat = async (scenario: string) => {
    try {
      const response = await api.ai.createChat({ scenario });
      chats.reload();
      navigate(`/chat/${response.session.id}`);
    } catch (cause) {
      setFailure(cause instanceof ApiError ? cause.message : 'Не удалось начать диалог');
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!sessionId || !text || waiting) return;

    // Реплику показываем сразу — ответ модели занимает пару секунд.
    const optimistic: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
      correction: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft('');
    setWaiting(true);
    setFailure(null);

    try {
      const { result } = await api.ai.sendMessage(sessionId, text);
      setMessages((current) => [
        ...current.map((message) =>
          message.id === optimistic.id
            ? { ...message, correction: result.correction ? { correction: result.correction, tip: result.tip } : null }
            : message,
        ),
        {
          id: optimistic.id + 1,
          role: 'assistant',
          content: result.reply,
          correction: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (user?.soundEnabled !== false) speak(result.reply);
      patchUser({ coins: (user?.coins ?? 0) + result.reward.coins });
      chats.reload();
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(text);
      setFailure(cause instanceof ApiError ? cause.message : 'Сообщение не отправлено');
    } finally {
      setWaiting(false);
    }
  };

  const removeChat = async (id: string) => {
    await api.ai.deleteChat(id);
    notify({ title: 'Диалог удалён', tone: 'neutral' });
    chats.reload();
    if (id === sessionId) navigate('/chat');
  };

  if (meta.loading && !meta.data) return <Loading label="Готовим диалог" />;
  if (meta.error) return <ErrorNote message={meta.error} onRetry={meta.reload} />;

  if (meta.data && !meta.data.enabled) {
    return (
      <div>
        <PageHeader title="Диалог" />
        <Card>
          <EmptyState
            title="Модуль ИИ выключен"
            description="Добавьте OPENAI_API_KEY в backend/.env и перезапустите сервер."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Диалог"
        description="Собеседник говорит на вашем уровне и разбирает ошибки в каждой реплике."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* ─── Сценарии и история диалогов ─── */}
        <aside>
          <Card>
            <SectionTitle title="Начать диалог" />
            <div className="space-y-1.5">
              {meta.data?.scenarios.map((scenario) => (
                <button
                  key={scenario.code}
                  type="button"
                  onClick={() => void startChat(scenario.code)}
                  className="hover:bg-sunken w-full rounded-xl px-3 py-2.5 text-left transition-colors"
                >
                  <span className="text-ink block text-[13px] font-medium">{scenario.title}</span>
                  <span className="text-faint mt-0.5 block text-[12px] leading-snug">{scenario.description}</span>
                </button>
              ))}
            </div>
          </Card>

          {(chats.data?.items.length ?? 0) > 0 ? (
            <Card className="mt-4">
              <SectionTitle title="Ваши диалоги" />
              <ul className="space-y-1">
                {chats.data?.items.map((item) => (
                  <li key={item.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/chat/${item.id}`)}
                      className={cx(
                        'min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                        item.id === sessionId ? 'bg-sunken' : 'hover:bg-sunken',
                      )}
                    >
                      <span className="text-ink block truncate text-[13px]">{item.title}</span>
                      <span className="text-faint text-[12px]">
                        {plural(item.messages, 'реплика', 'реплики', 'реплик')} · {formatRelative(item.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeChat(item.id)}
                      aria-label="Удалить диалог"
                      className="text-faint hover:text-danger shrink-0 px-1.5 py-1 text-[13px] opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </aside>

        {/* ─── Лента ─── */}
        <section>
          {!sessionId ? (
            <Card>
              <EmptyState
                title="Выберите сценарий"
                description="Диалог идёт на английском. После каждой вашей реплики появится разбор ошибок, если они были."
              />
            </Card>
          ) : (
            <Card className="flex h-[70vh] flex-col" padded={false}>
              <div className="border-line flex items-center gap-2 border-b px-5 py-3.5">
                <span className="text-ink text-sm font-medium">{title}</span>
                <Badge className="ml-auto">{user?.cefrLevel}</Badge>
              </div>

              <div ref={feedRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {loadingChat ? (
                  <Loading label="" />
                ) : messages.length === 0 ? (
                  <p className="text-faint py-10 text-center text-[13px]">
                    Напишите первую реплику по-английски — например, поздоровайтесь.
                  </p>
                ) : (
                  messages.map((message) => <Bubble key={message.id} message={message} />)
                )}

                {waiting ? (
                  <div className="text-faint flex items-center gap-2 text-[13px]">
                    <Spinner /> собеседник печатает
                  </div>
                ) : null}
              </div>

              {failure ? (
                <div className="px-5 pb-3">
                  <ErrorNote message={failure} />
                </div>
              ) : null}

              <form
                className="border-line flex items-end gap-2.5 border-t px-5 py-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  lang="en"
                  placeholder="Type in English…"
                  className="border-line bg-raised text-ink placeholder:text-faint focus:border-ink flex-1 resize-none rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed transition-colors outline-none"
                />
                <Button type="submit" variant="primary" size="lg" loading={waiting} disabled={!draft.trim()}>
                  Отправить
                </Button>
              </form>
              <p className="text-faint px-5 pb-3 text-[12px]">
                <Kbd>Enter</Kbd> — отправить, <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> — новая строка
              </p>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const own = message.role === 'user';

  return (
    <div className={cx('flex flex-col', own ? 'items-end' : 'items-start')}>
      <div
        className={cx(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          own ? 'bg-ink text-surface' : 'bg-sunken text-ink',
        )}
      >
        {message.content}
      </div>

      {!own ? (
        <button
          type="button"
          onClick={() => speak(message.content)}
          className="text-faint hover:text-ink mt-1 text-[12px] transition-colors"
        >
          Прослушать
        </button>
      ) : null}

      {message.correction?.correction ? (
        <div className="bg-warning-soft mt-2 max-w-[85%] rounded-xl px-3.5 py-2.5">
          <p className="text-warning text-[12px] font-medium">Как правильнее</p>
          <p className="text-ink mt-1 text-[13px] leading-relaxed">{message.correction.correction}</p>
          {message.correction.tip ? (
            <p className="text-soft mt-1 text-[12px] leading-relaxed">{message.correction.tip}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
