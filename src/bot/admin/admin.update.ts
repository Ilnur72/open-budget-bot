import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InputFile, type Bot } from 'grammy';
import { AdminService, type AdminStats, type VoteWithUser } from '../../admin/admin.service';
import { toErrorInfo } from '../../common/utils/error.util';
import { escapeHtml } from '../../common/utils/escape-html.util';
import { maskPhone } from '../../common/utils/mask-phone.util';
import { formatVoteStatus } from '../bot.messages';
import type { BotContext } from '../bot.types';
import {
  ADMIN_CALLBACKS,
  BROADCAST_CANCEL_PATTERN,
  BROADCAST_CONFIRM_PATTERN,
  buildAdminKeyboard,
  buildBroadcastConfirmKeyboard,
  buildRefreshKeyboard,
} from './admin.keyboard';
import { BroadcastService, type BroadcastProgress } from './broadcast.service';
import { buildCsvHeader, buildCsvRow } from './csv.util';
import { MAX_BROADCAST_LENGTH, PendingBroadcastStore } from './pending-broadcast.store';

/** Broadcast holati shuncha xabardan keyin yangilanadi. */
const PROGRESS_UPDATE_STEP = 500;

/**
 * Ikki eksport orasidagi eng qisqa vaqt.
 * Eksport og'ir amal, grammY esa update'larni KETMA-KET ishlaydi — takror
 * chaqirilsa bot boshqa hech kimga javob bera olmay qolardi.
 */
const EXPORT_COOLDOWN_MS = 5 * 60 * 1000;

/** Eksport fayli chatdan shuncha vaqtdan keyin avtomatik o'chiriladi. */
const EXPORT_AUTO_DELETE_MS = 10 * 60 * 1000;

/**
 * Admin buyruqlari.
 *
 * Barcha handlerlar `guard()` orqali o'tadi: admin bo'lmagan foydalanuvchi
 * buyruq MAVJUDLIGINI ham bilmasligi kerak, shuning uchun rad javobi
 * oddiy "noma'lum buyruq" bilan bir xil.
 */
@Injectable()
export class AdminUpdate {
  private readonly logger = new Logger(AdminUpdate.name);

  /** Oxirgi eksport vaqti — Redis'ga bog'liq bo'lmagan qattiq chegara. */
  private lastExportAt = new Map<number, number>();
  private exportRunning = false;

  constructor(
    private readonly adminService: AdminService,
    private readonly broadcastService: BroadcastService,
    private readonly pendingBroadcast: PendingBroadcastStore,
    private readonly configService: ConfigService,
  ) {}

  register(bot: Bot<BotContext>): void {
    bot.command('admin', (ctx) =>
      this.guard(ctx, async () => {
        await ctx.reply('🛠 <b>Admin panel</b>', {
          parse_mode: 'HTML',
          reply_markup: buildAdminKeyboard(),
        });
      }),
    );

    bot.command('stats', (ctx) => this.guard(ctx, () => this.replyStats(ctx)));
    bot.command('today', (ctx) => this.guard(ctx, () => this.replyToday(ctx)));
    bot.command('users', (ctx) => this.guard(ctx, () => this.replyUsers(ctx)));
    bot.command('recent', (ctx) => this.guard(ctx, () => this.replyRecent(ctx)));
    bot.command('export', (ctx) => this.guard(ctx, () => this.startExport(ctx)));
    bot.command('broadcast', (ctx) => this.guard(ctx, () => this.prepareBroadcast(ctx)));

    bot.callbackQuery(ADMIN_CALLBACKS.stats, (ctx) =>
      this.guardCallback(ctx, () => this.replyStats(ctx, true)),
    );
    bot.callbackQuery(ADMIN_CALLBACKS.today, (ctx) =>
      this.guardCallback(ctx, () => this.replyToday(ctx, true)),
    );
    bot.callbackQuery(ADMIN_CALLBACKS.users, (ctx) =>
      this.guardCallback(ctx, () => this.replyUsers(ctx, true)),
    );
    bot.callbackQuery(ADMIN_CALLBACKS.recent, (ctx) =>
      this.guardCallback(ctx, () => this.replyRecent(ctx, true)),
    );
    bot.callbackQuery(ADMIN_CALLBACKS.export, (ctx) =>
      this.guardCallback(ctx, () => this.startExport(ctx)),
    );
    bot.callbackQuery(BROADCAST_CONFIRM_PATTERN, (ctx) =>
      this.guardCallback(ctx, () => this.runBroadcast(ctx, ctx.match?.[1] ?? '')),
    );
    bot.callbackQuery(BROADCAST_CANCEL_PATTERN, (ctx) =>
      this.guardCallback(ctx, async () => {
        const adminId = ctx.from?.id;
        if (adminId !== undefined) {
          await this.pendingBroadcast.clear(adminId, ctx.match?.[1] ?? '');
        }
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        await ctx.reply('❌ Broadcast bekor qilindi.');
      }),
    );

    this.logger.log("Admin handlerlari ro'yxatdan o'tkazildi");
  }

  /** Admin emasligini bildirmasdan rad etadi. */
  private async guard(ctx: BotContext, handler: () => Promise<void>): Promise<void> {
    const telegramId = ctx.from?.id;
    if (telegramId === undefined || !this.adminService.isAdmin(telegramId)) {
      this.logger.warn(`Ruxsatsiz admin urinishi: telegramId=${telegramId ?? 'nomalum'}`);
      // Oddiy foydalanuvchi ko'radigan javob bilan AYNAN bir xil.
      await ctx.reply("❓ Noma'lum buyruq. Yordam uchun /help");
      return;
    }
    await handler();
  }

  /** Callback uchun himoya — javobsiz qoldirmaslik uchun `answerCallbackQuery` bor. */
  private async guardCallback(ctx: BotContext, handler: () => Promise<void>): Promise<void> {
    const telegramId = ctx.from?.id;
    if (telegramId === undefined || !this.adminService.isAdmin(telegramId)) {
      // Matnsiz javob — noma'lum tugmadan farq qilmasin, aks holda
      // callback nomining haqiqiyligi tasdiqlanib qolardi.
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await handler();
  }

  private async replyStats(ctx: BotContext, edit = false): Promise<void> {
    const stats = await this.adminService.getStats();
    await this.render(ctx, formatStats(stats), ADMIN_CALLBACKS.stats, edit);
  }

  private async replyToday(ctx: BotContext, edit = false): Promise<void> {
    const stats = await this.adminService.getTodayStats();
    const timeZone = this.configService.getOrThrow<string>('app.timeZone');

    const text =
      `📅 <b>Bugungi statistika</b> <i>(${timeZone})</i>\n\n` +
      `🗳 Urinishlar: ${stats.total}\n` +
      `✅ Muvaffaqiyatli: ${stats.success}\n` +
      `❌ Muvaffaqiyatsiz: ${stats.failed}\n` +
      `⏳ Jarayonda: ${stats.pending}\n` +
      `📈 Muvaffaqiyat: ${stats.successRate}%`;

    await this.render(ctx, text, ADMIN_CALLBACKS.today, edit);
  }

  private async replyUsers(ctx: BotContext, edit = false): Promise<void> {
    const stats = await this.adminService.getStats();

    const text =
      '👥 <b>Foydalanuvchilar</b>\n\n' +
      `Jami: ${stats.totalUsers}\n` +
      `🚫 Bloklagan: ${stats.blockedUsers}\n` +
      `📱 Ovoz bergan unikal raqamlar: ${stats.uniqueSuccessfulPhones}`;

    await this.render(ctx, text, ADMIN_CALLBACKS.users, edit);
  }

  private async replyRecent(ctx: BotContext, edit = false): Promise<void> {
    const votes = await this.adminService.getRecentVotes();
    const timeZone = this.configService.getOrThrow<string>('app.timeZone');

    const text =
      votes.length === 0
        ? "📋 Hali ovoz urinishlari yo'q."
        : `📋 <b>So'nggi ${votes.length} ta urinish</b>\n\n${votes
            .map((vote) => formatVoteLine(vote, timeZone))
            .join('\n')}`;

    await this.render(ctx, text, ADMIN_CALLBACKS.recent, edit);
  }

  /** Matnni yangi xabar sifatida yoki mavjudini tahrirlab ko'rsatadi. */
  private async render(
    ctx: BotContext,
    text: string,
    refreshCallback: string,
    edit: boolean,
  ): Promise<void> {
    const options = {
      parse_mode: 'HTML' as const,
      reply_markup: buildRefreshKeyboard(refreshCallback),
    };

    if (!edit) {
      await ctx.reply(text, options);
      return;
    }

    // Bir xil matnni qayta tahrirlash Telegram'da xatolik beradi — e'tiborsiz qoldiramiz.
    await ctx.editMessageText(text, options).catch(() => undefined);
  }

  /** Eksportni fonda boshlaydi — bot boshqa update'larni ishlashda davom etsin. */
  private async startExport(ctx: BotContext): Promise<void> {
    const adminId = ctx.from?.id;
    if (adminId === undefined) {
      return;
    }

    if (this.exportRunning) {
      await ctx.reply('⏳ Eksport allaqachon tayyorlanmoqda.');
      return;
    }

    const lastAt = this.lastExportAt.get(adminId) ?? 0;
    const waitMs = EXPORT_COOLDOWN_MS - (Date.now() - lastAt);
    if (waitMs > 0) {
      await ctx.reply(`⏳ Keyingi eksport ${Math.ceil(waitMs / 60_000)} daqiqadan keyin.`);
      return;
    }

    // `/export full` — maskalanmagan raqamlar bilan (ataylab qiyinroq yo'l).
    const full = (ctx.match ?? '').toString().trim().toLowerCase() === 'full';

    this.exportRunning = true;
    this.lastExportAt.set(adminId, Date.now());
    await ctx.reply('⏳ Eksport tayyorlanmoqda...');

    void this.runExport(ctx, adminId, full).finally(() => {
      this.exportRunning = false;
    });
  }

  private async runExport(ctx: BotContext, adminId: number, full: boolean): Promise<void> {
    try {
      const totalAvailable = await this.adminService.countExportRows();

      // Qatorlar bo'laklab o'qiladi: hammasini bir marta olish 50k da
      // ~300 MB RSS talab qilardi va konteynerni OOM ga olib borardi.
      const parts: string[] = [
        buildCsvHeader([
          'vote_id',
          'created_at',
          'telegram_id',
          'username',
          'phone',
          'status',
          'error',
        ]),
      ];
      let exported = 0;

      for await (const chunk of this.adminService.streamExportRows(!full)) {
        for (const row of chunk) {
          parts.push(
            buildCsvRow([
              row.voteId,
              row.createdAt.toISOString(),
              row.telegramId,
              row.username,
              row.phone,
              row.status,
              row.errorMessage,
            ]),
          );
        }
        exported += chunk.length;
      }

      const truncated = totalAvailable > exported;
      const caption =
        `📤 ${exported} ta yozuv` +
        (truncated ? ` (jami ${totalAvailable} tadan, eng yangilari)` : '') +
        '\n' +
        (full
          ? '⚠️ Raqamlar OCHIQ. Fayl Telegram serverida qoladi — uni tarqatmang.'
          : "🔒 Raqamlar maskalangan. To'liq raqamlar uchun: /export full");

      const fileName = `votes-${new Date().toISOString().slice(0, 10)}.csv`;
      const sent = await ctx.replyWithDocument(
        new InputFile(Buffer.from(parts.join(''), 'utf8'), fileName),
        { caption },
      );

      await this.adminService.logAction(adminId, 'EXPORT', {
        rows: exported,
        totalAvailable,
        masked: !full,
      });

      // Fayl chat tarixida abadiy qolmasin — u yerdan butun baza sizib chiqardi.
      this.scheduleDelete(ctx, sent.chat.id, sent.message_id);
    } catch (error) {
      this.logger.error(`Eksport yiqildi: ${toErrorInfo(error).message}`);
      await ctx.reply("❌ Eksport tayyorlanmadi. Keyinroq urinib ko'ring.").catch(() => undefined);
    }
  }

  /** Eksport faylini belgilangan vaqtdan keyin chatdan o'chiradi. */
  private scheduleDelete(ctx: BotContext, chatId: number, messageId: number): void {
    const timer = setTimeout(() => {
      void ctx.api.deleteMessage(chatId, messageId).catch(() => undefined);
    }, EXPORT_AUTO_DELETE_MS);
    // Ilova to'xtashiga to'sqinlik qilmasin.
    timer.unref();
  }

  /** `/broadcast <matn>` — matnni saqlaydi va tasdiqlash so'raydi. */
  private async prepareBroadcast(ctx: BotContext): Promise<void> {
    const adminId = ctx.from?.id;
    const text = (ctx.match ?? '').toString().trim();

    if (adminId === undefined) {
      return;
    }
    if (text.length === 0) {
      await ctx.reply(
        '📢 Foydalanish: <code>/broadcast Xabar matni</code>\n\n' +
          "HTML teglari qo'llab-quvvatlanadi.",
        { parse_mode: 'HTML' },
      );
      return;
    }
    if (text.length > MAX_BROADCAST_LENGTH) {
      await ctx.reply(`❌ Xabar juda uzun (${text.length}/${MAX_BROADCAST_LENGTH}).`);
      return;
    }
    if (this.broadcastService.isRunning) {
      await ctx.reply('⏳ Broadcast allaqachon ketmoqda. Tugashini kuting.');
      return;
    }

    const id = await this.pendingBroadcast.save(adminId, text);

    try {
      await ctx.reply(`📢 <b>Yuborilishi kutilmoqda:</b>\n\n${text}\n\n<i>Tasdiqlang:</i>`, {
        parse_mode: 'HTML',
        reply_markup: buildBroadcastConfirmKeyboard(id),
      });
    } catch (error) {
      // Preview ko'rsatilmasa (masalan buzuq HTML) matn Redis'da qolmasin —
      // aks holda tasdiqlanmagan xabar keyinroq yuborilib ketishi mumkin edi.
      await this.pendingBroadcast.clear(adminId, id);
      await ctx.reply(
        '❌ Xabar matni Telegram tomonidan qabul qilinmadi (HTML teglarini tekshiring).',
      );
      this.logger.warn(`Broadcast preview yiqildi: ${toErrorInfo(error).message}`);
      return;
    }

    await this.adminService.logAction(adminId, 'BROADCAST_PREPARED', { length: text.length });
  }

  /** Tasdiqlangan broadcast'ni fonda ishga tushiradi. */
  private async runBroadcast(ctx: BotContext, id: string): Promise<void> {
    const adminId = ctx.from?.id;
    if (adminId === undefined || id.length === 0) {
      return;
    }

    const text = await this.pendingBroadcast.take(adminId, id);
    if (text === null) {
      await ctx.reply('⌛️ Xabar muddati tugagan. Qaytadan /broadcast yuboring.');
      return;
    }
    if (this.broadcastService.isRunning) {
      await ctx.reply('⏳ Broadcast allaqachon ketmoqda.');
      return;
    }

    // Tugmani olib tashlaymiz — ikkinchi marta bosilmasin.
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

    const status = await ctx.reply('📤 Yuborilmoqda...');
    let lastReported = 0;

    // Fonda ishlaydi: minglab xabar yuborish handler'ni bloklab qo'ymasin.
    void this.broadcastService
      .broadcast(ctx.api, text, async (progress) => {
        if (progress.total - lastReported < PROGRESS_UPDATE_STEP) {
          return;
        }
        lastReported = progress.total;
        await ctx.api
          .editMessageText(status.chat.id, status.message_id, formatProgress(progress, false), {
            parse_mode: 'HTML',
          })
          .catch(() => undefined);
      })
      .then(async (progress) => {
        await ctx.api
          .editMessageText(status.chat.id, status.message_id, formatProgress(progress, true), {
            parse_mode: 'HTML',
          })
          .catch(() => undefined);
        await this.adminService.logAction(adminId, 'BROADCAST_SENT', {
          sent: progress.sent,
          blocked: progress.blocked,
          failed: progress.failed,
        });
      })
      .catch(async (error: unknown) => {
        this.logger.error(`Broadcast yiqildi: ${toErrorInfo(error).message}`);
        await ctx.reply('❌ Broadcast yiqildi.').catch(() => undefined);
      });
  }
}

function formatStats(stats: AdminStats): string {
  return (
    '📊 <b>Umumiy statistika</b>\n\n' +
    `👥 Foydalanuvchilar: ${stats.totalUsers}\n` +
    `🗳 Jami urinishlar: ${stats.total}\n` +
    `✅ Muvaffaqiyatli: ${stats.success}\n` +
    `❌ Muvaffaqiyatsiz: ${stats.failed}\n` +
    `⏳ Jarayonda: ${stats.pending}\n` +
    `📱 Unikal raqamlar: ${stats.uniqueSuccessfulPhones}\n` +
    `📈 Muvaffaqiyat: ${stats.successRate}%`
  );
}

function formatProgress(progress: BroadcastProgress, done: boolean): string {
  return (
    `${done ? '✅ <b>Broadcast tugadi</b>' : '📤 <b>Yuborilmoqda...</b>'}\n\n` +
    `Yuborildi: ${progress.sent}\n` +
    `🚫 Bloklagan: ${progress.blocked}\n` +
    `⚠️ Xato: ${progress.failed}`
  );
}

function formatVoteLine(vote: VoteWithUser, timeZone: string): string {
  const who = vote.user.username !== null ? `@${vote.user.username}` : (vote.user.firstName ?? '—');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(vote.createdAt);

  return `• ${time} — ${escapeHtml(who)} — ${maskPhone(vote.phone)} — ${formatVoteStatus(vote.status)}`;
}
