import { Badge, Card, ErrorNote, Loading, PageHeader, Progress, SectionTitle, Stat, cx } from '../components/ui';
import { RatingPoints, RatingPointsLabel } from '../components/RatingPoints';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import type { LevelRewardItem } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';

const KIND_LABELS: Record<LevelRewardItem['kind'], string> = {
  mode: 'Режим',
  theme: 'Оформление',
  freeze: 'Заморозка',
};

export function Rewards() {
  const rewards = useAsync(() => api.rewards.list(), []);
  const user = useAuth((state) => state.user);

  if (rewards.loading && !rewards.data) return <Loading label="Смотрим награды" />;
  if (rewards.error) return <ErrorNote message={rewards.error} onRetry={rewards.reload} />;
  if (!rewards.data || !user) return null;

  const { progress, items, streakFreezes, maxStreakFreezes, freezeGrantEvery } = rewards.data;
  const nextLevelItems = items.filter((item) => !item.unlocked);

  return (
    <div>
      <PageHeader
        title="Награды"
        description="Очки рейтинга не тратятся. Всё, что есть в приложении, открывается ростом уровня."
        action={
          <RatingPoints amount={rewards.data.points} iconSize={15} valueClassName="text-[15px] font-semibold text-ink" />
        }
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
          <div className="min-w-56 flex-1">
            <div className="flex items-baseline justify-between">
              <p className="text-ink text-sm font-medium">Уровень {progress.level}</p>
              <p className="text-faint text-[12px] tabular-nums">
                {progress.isMax
                  ? 'максимум'
                  : `${formatNumber(progress.pointsIntoLevel)} / ${formatNumber(progress.pointsForLevel)}`}
              </p>
            </div>
            <Progress className="mt-2.5" value={progress.progress} />
            <p className="text-faint mt-2 text-[12px]">
              {progress.isMax
                ? 'Тысячный уровень — дальше расти некуда.'
                : (
                    <>
                      До {progress.level + 1} уровня —{' '}
                      <RatingPointsLabel amount={progress.pointsToNext} valueClassName="text-[12px]" />.
                    </>
                  )}
            </p>
          </div>

          <div className="border-line hidden h-14 border-l sm:block" />

          <Stat
            label="Заморозки серии"
            value={`${streakFreezes} / ${maxStreakFreezes}`}
            hint={`выдаётся каждые ${freezeGrantEvery} уровней`}
            tone={streakFreezes > 0 ? 'accent' : undefined}
          />

          <Stat
            label="Ближайшая награда"
            value={nextLevelItems[0] ? `${nextLevelItems[0].level} ур.` : '—'}
            hint={nextLevelItems[0]?.title ?? 'всё открыто'}
          />
        </div>
      </Card>

      <SectionTitle title="Что открывает уровень" description="Награда выдаётся сама, как только уровень достигнут" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.code} className={cx('flex flex-col', !item.unlocked && 'opacity-60')}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-ink text-sm font-medium">{item.title}</p>
              {item.unlocked ? (
                <Badge tone="success">{item.kind === 'freeze' ? `×${item.quantity}` : 'открыто'}</Badge>
              ) : (
                <Badge>с {item.level} ур.</Badge>
              )}
            </div>

            <p className="text-soft mt-1.5 flex-1 text-[13px] leading-relaxed">{item.description}</p>

            <p className="text-faint mt-4 text-[12px]">
              {KIND_LABELS[item.kind]} · {item.unlocked ? 'доступно' : `нужен ${item.level} уровень`}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
