# 06 — Admin Buyruqlari va Statistika

## Vazifa

Admin foydalanuvchilar uchun Telegram orqali boshqaruv va statistika funksiyalari.

## Admin buyruqlari:

| Buyruq | Vazifasi |
|--------|----------|
| `/admin` | Admin panel (inline keyboard) |
| `/stats` | Umumiy statistika |
| `/today` | Bugungi statistika |
| `/users` | Foydalanuvchilar soni |
| `/broadcast` | Barcha foydalanuvchilarga xabar |
| `/export` | Excel/CSV eksport |

## Admin middleware:

```typescript
// src/bot/middlewares/admin.middleware.ts
import { Context, NextFunction } from 'grammy';

export function adminOnly(adminIds: number[]) {
  return async (ctx: Context, next: NextFunction) => {
    const userId = ctx.from?.id;
    if (!userId || !adminIds.includes(userId)) {
      await ctx.reply('⛔ Sizda admin huquqi yo\'q.');
      return;
    }
    await next();
  };
}
```

## Admin Service:

```typescript
// src/admin/admin.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [total, success, failed, pending, uniquePhones, totalUsers] =
      await Promise.all([
        this.prisma.vote.count(),
        this.prisma.vote.count({ where: { status: 'SUCCESS' } }),
        this.prisma.vote.count({ where: { status: 'FAILED' } }),
        this.prisma.vote.count({ where: { status: 'PENDING' } }),
        this.prisma.vote.findMany({
          where: { status: 'SUCCESS' },
          select: { phone: true },
          distinct: ['phone'],
        }),
        this.prisma.user.count(),
      ]);

    return {
      total,
      success,
      failed,
      pending,
      uniquePhones: uniquePhones.length,
      totalUsers,
      successRate: total > 0 ? ((success / total) * 100).toFixed(1) : '0',
    };
  }

  async getTodayStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, success, failed] = await Promise.all([
      this.prisma.vote.count({
        where: { createdAt: { gte: today } },
      }),
      this.prisma.vote.count({
        where: { createdAt: { gte: today }, status: 'SUCCESS' },
      }),
      this.prisma.vote.count({
        where: { createdAt: { gte: today }, status: 'FAILED' },
      }),
    ]);

    return { total, success, failed };
  }

  async getRecentVotes(limit = 10) {
    return this.prisma.vote.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: { firstName: true, username: true },
        },
      },
    });
  }

  async getAllUserIds(): Promise<bigint[]> {
    const users = await this.prisma.user.findMany({
      where: { isBlocked: false },
      select: { telegramId: true },
    });
    return users.map((u) => u.telegramId);
  }
}
```

## Admin handlers (bot.update.ts ga qo'shish):

```typescript
// Admin panel
bot.command('admin', adminOnly(adminIds), async (ctx) => {
  await ctx.reply('🔧 *Admin Panel*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊 Statistika', callback_data: 'admin_stats' },
          { text: '📅 Bugun', callback_data: 'admin_today' },
        ],
        [
          { text: '👥 Foydalanuvchilar', callback_data: 'admin_users' },
          { text: '📋 So\'nggi ovozlar', callback_data: 'admin_recent' },
        ],
        [
          { text: '📢 Xabar yuborish', callback_data: 'admin_broadcast' },
          { text: '📤 Eksport', callback_data: 'admin_export' },
        ],
      ],
    },
  });
});

// Statistika callback
bot.callbackQuery('admin_stats', async (ctx) => {
  const stats = await adminService.getStats();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    '📊 *Umumiy Statistika*\n\n' +
    `👥 Foydalanuvchilar: ${stats.totalUsers}\n` +
    `🗳 Jami ovozlar: ${stats.total}\n` +
    `✅ Muvaffaqiyatli: ${stats.success}\n` +
    `❌ Muvaffaqiyatsiz: ${stats.failed}\n` +
    `⏳ Kutilmoqda: ${stats.pending}\n` +
    `📱 Unikal raqamlar: ${stats.uniquePhones}\n` +
    `📈 Muvaffaqiyat darajasi: ${stats.successRate}%`,
    { parse_mode: 'Markdown' },
  );
});

// Broadcast
bot.callbackQuery('admin_broadcast', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('📢 Xabar matnini yuboring:');
  // conversation orqali xabar olish va broadcast qilish
});
```

## Talablar:

1. Admin ID'lari `.env` da vergul bilan ajratilgan holda saqlansin
2. `/stats` ning javobida inline "🔄 Yangilash" tugmasi bo'lsin
3. Broadcast: rate limiting (har 50 ms da 1 xabar) — Telegram API cheklovlariga rioya
4. Export: CSV formatda fayl yaratib, `sendDocument` bilan yuborish
5. So'nggi ovozlar: oxirgi 10 ta ovoz, vaqti va holati bilan
6. Admin buyruqlari oddiy foydalanuvchilarga ko'rinmasin
