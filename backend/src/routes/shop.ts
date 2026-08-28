import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { SHOP_ITEMS, findShopItem } from '../lib/economy.js';
import { applyBalance } from '../services/progress.js';

const shopRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const [user, inventory] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: request.userId }, select: { coins: true, level: true, streakFreezes: true } }),
      prisma.inventoryItem.findMany({ where: { userId: request.userId } }),
    ]);

    const owned = new Map(inventory.map((i) => [i.itemCode, i.quantity]));

    return {
      coins: user.coins,
      items: SHOP_ITEMS.map((item) => {
        const quantity = item.code === 'freeze' ? user.streakFreezes : owned.get(item.code) ?? 0;
        const atLimit = item.consumable ? quantity >= (item.maxQuantity ?? Infinity) : quantity > 0;
        return {
          ...item,
          quantity,
          canBuy: user.coins >= item.price && !atLimit && user.level >= (item.requiresLevel ?? 1),
          reason: (() => {
            if (user.level < (item.requiresLevel ?? 1)) return `Откроется на ${item.requiresLevel} уровне`;
            if (atLimit) return item.consumable ? 'Достигнут максимум' : 'Уже приобретено';
            if (user.coins < item.price) return 'Недостаточно монет';
            return null;
          })(),
        };
      }),
    };
  });

  app.post('/buy', async (request, reply) => {
    const parsed = z.object({ code: z.string().min(1).max(40) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Не указан товар' });

    const item = findShopItem(parsed.data.code);
    if (!item) return reply.code(404).send({ error: 'Товар не найден' });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: { coins: true, level: true, streakFreezes: true },
    });

    if (user.level < (item.requiresLevel ?? 1)) {
      return reply.code(403).send({ error: `Товар откроется на ${item.requiresLevel} уровне` });
    }
    if (user.coins < item.price) {
      return reply.code(402).send({ error: 'Недостаточно монет' });
    }

    // Заморозки серии живут отдельным полем пользователя — им пользуется
    // логика дневной серии.
    if (item.code === 'freeze') {
      if (user.streakFreezes >= (item.maxQuantity ?? 5)) {
        return reply.code(409).send({ error: 'Больше заморозок держать нельзя' });
      }
      await prisma.user.update({ where: { id: request.userId }, data: { streakFreezes: { increment: 1 } } });
    } else {
      const existing = await prisma.inventoryItem.findUnique({
        where: { userId_itemCode: { userId: request.userId, itemCode: item.code } },
      });
      const quantity = existing?.quantity ?? 0;

      if (!item.consumable && quantity > 0) {
        return reply.code(409).send({ error: 'Товар уже приобретён' });
      }
      if (item.consumable && quantity >= (item.maxQuantity ?? Infinity)) {
        return reply.code(409).send({ error: 'Достигнут максимум' });
      }

      await prisma.inventoryItem.upsert({
        where: { userId_itemCode: { userId: request.userId, itemCode: item.code } },
        create: { userId: request.userId, itemCode: item.code, quantity: 1 },
        update: { quantity: { increment: 1 } },
      });
    }

    const balance = await applyBalance(request.userId, {
      coins: -item.price,
      reason: `purchase:${item.code}`,
      meta: { title: item.title },
    });

    return { ok: true, balance: balance.balance };
  });

  app.get('/inventory', async (request) => {
    const [items, user] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { userId: request.userId } }),
      prisma.user.findUniqueOrThrow({ where: { id: request.userId }, select: { streakFreezes: true } }),
    ]);
    return { items, streakFreezes: user.streakFreezes };
  });
};

export default shopRoutes;
