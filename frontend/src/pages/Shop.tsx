import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Loading, PageHeader, cx } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatNumber } from '../lib/format';
import type { ShopItem } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../store/auth';
import { THEME_BY_ITEM_CODE, useUi, type Theme } from '../store/ui';

export function Shop() {
  const shop = useAsync(() => api.shop.list(), []);
  const patchUser = useAuth((state) => state.patchUser);
  const refresh = useAuth((state) => state.refresh);
  const notify = useUi((state) => state.notify);
  const setUnlockedThemes = useUi((state) => state.setUnlockedThemes);
  const [buying, setBuying] = useState<string | null>(null);

  const buy = async (item: ShopItem) => {
    setBuying(item.code);
    try {
      const { balance } = await api.shop.buy(item.code);
      patchUser({ coins: balance });
      notify({ title: item.title, description: 'Покупка совершена', tone: 'success' });
      shop.reload();
      void refresh();

      // Купленное оформление должно стать доступным сразу.
      if (THEME_BY_ITEM_CODE[item.code]) {
        const { items } = await api.shop.inventory();
        setUnlockedThemes(
          items
            .filter((entry) => entry.quantity > 0 && THEME_BY_ITEM_CODE[entry.itemCode])
            .map((entry) => THEME_BY_ITEM_CODE[entry.itemCode] as Theme),
        );
      }
    } catch (cause) {
      notify({ title: cause instanceof ApiError ? cause.message : 'Покупка не удалась', tone: 'danger' });
    } finally {
      setBuying(null);
    }
  };

  if (shop.loading && !shop.data) return <Loading label="Открываем магазин" />;
  if (shop.error) return <ErrorNote message={shop.error} onRetry={shop.reload} />;
  if (!shop.data) return null;

  return (
    <div>
      <PageHeader
        title="Магазин"
        description="Монеты зарабатываются на верных ответах и заданиях ИИ."
        action={
          <span className="text-ink text-[15px] font-semibold tabular-nums">
            {formatNumber(shop.data.coins)} монет
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shop.data.items.map((item) => (
          <Card key={item.code} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <p className="text-ink text-sm font-medium">{item.title}</p>
              {item.quantity > 0 ? (
                <Badge tone="success">{item.consumable ? `×${item.quantity}` : 'есть'}</Badge>
              ) : item.requiresLevel && item.requiresLevel > 1 ? (
                <Badge>с {item.requiresLevel} ур.</Badge>
              ) : null}
            </div>

            <p className="text-soft mt-1.5 flex-1 text-[13px] leading-relaxed">{item.description}</p>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className={cx('text-[15px] font-semibold tabular-nums', item.canBuy ? 'text-ink' : 'text-faint')}>
                {formatNumber(item.price)}
              </span>
              <Button
                size="sm"
                variant={item.canBuy ? 'primary' : 'secondary'}
                disabled={!item.canBuy}
                loading={buying === item.code}
                onClick={() => void buy(item)}
              >
                {item.canBuy ? 'Купить' : (item.reason ?? 'Недоступно')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
