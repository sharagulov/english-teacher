import { Link } from 'react-router-dom';
import { Card, EmptyState, PageHeader } from '../components/ui';
import { CHAT_DISABLED_HINT } from '../lib/features';

export function ChatUnavailable() {
  return (
    <div>
      <PageHeader title="Диалог" />
      <Card>
        <EmptyState
          title={CHAT_DISABLED_HINT}
          description="Диалог с репетитором ещё в разработке. Пока можно заниматься в разделе «Задания ИИ»."
          action={
            <Link
              to="/ai"
              className="bg-ink text-surface inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium transition-opacity hover:opacity-85"
            >
              Перейти к заданиям
            </Link>
          }
        />
      </Card>
    </div>
  );
}
