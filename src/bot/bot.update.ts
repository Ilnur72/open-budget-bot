import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Bot } from 'grammy';
import { toErrorInfo } from '../common/utils/error.util';
import { escapeHtml } from '../common/utils/escape-html.util';
import { maskPhone } from '../common/utils/mask-phone.util';
import { UserService } from '../user/user.service';
import { VoteService } from '../vote/vote.service';
import { formatVoteStatus } from './bot.messages';
import type { BotContext } from './bot.types';
import { VOTE_CONVERSATION_ID } from './conversations/vote.conversation';
import {
  VOTE_START_CALLBACK,
  buildMainKeyboard,
  buildOfficialBotUrl,
} from './keyboards/vote.keyboard';

/** `/status` da ko'rsatiladigan oxirgi ovozlar soni. */
const STATUS_PAGE_SIZE = 5;

/**
 * Bot buyruqlari va callback handlerlari.
 * `BotService` bot instansiyasini yaratadi, bu klass unga handlerlarni ulaydi.
 */
@Injectable()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  /**
   * `BotService` ni to'g'ridan-to'g'ri inject qilib bo'lmaydi (aylanma
   * bog'liqlik), shuning uchun kerakli metodlar shu interfeys orqali beriladi.
   */
  private exitSilently: ((ctx: BotContext, telegramId: number) => Promise<void>) | null = null;

  constructor(
    private readonly userService: UserService,
    private readonly voteService: VoteService,
    private readonly configService: ConfigService,
  ) {}

  /** Barcha handlerlarni bot instansiyasiga ro'yxatdan o'tkazadi. */
  register(
    bot: Bot<BotContext>,
    host: { exitSilently: (ctx: BotContext, telegramId: number) => Promise<void> },
  ): void {
    this.exitSilently = host.exitSilently.bind(host);
    bot.command('start', async (ctx) => {
      await this.rememberUser(ctx);
      await ctx.reply(
        `👋 <b>Assalomu alaykum, ${escapeHtml(ctx.from?.first_name ?? 'foydalanuvchi')}!</b>\n\n` +
          '🗳 Mahallamiz loyihasiga ovoz berish uchun bot.\n\n' +
          "<b>Eng oson yo'l</b> — pastdagi birinchi tugma. U sizni rasmiy " +
          'Ochiq Byudjet botiga olib boradi, u yerda faqat <b>bitta tugma</b> ' +
          'bosasiz: captcha ham, SMS ham kerak emas.\n\n' +
          'Agar Telegram akkauntingizdagidan <b>boshqa raqam</b> bilan ovoz ' +
          "bermoqchi bo'lsangiz, ikkinchi tugmani tanlang.",
        { parse_mode: 'HTML', reply_markup: buildMainKeyboard(this.officialBotUrl()) },
      );
    });

    bot.command('help', async (ctx) => {
      await ctx.reply(
        '❓ <b>Yordam</b>\n\n' +
          'Ovoz berish tartibi:\n' +
          "1. /vote buyrug'ini bering\n" +
          '2. Captchani yeching\n' +
          '3. Telefon raqamingizni kiriting\n' +
          '4. SMS kodni tasdiqlang\n\n' +
          '⚠️ Bir telefon raqamdan loyihaga faqat bir marta ovoz berish mumkin.\n' +
          '⏳ Har bir bosqichda javob berish uchun 5 daqiqa vaqtingiz bor.',
        { parse_mode: 'HTML' },
      );
    });

    bot.command('vote', (ctx) => this.startVote(ctx));

    bot.callbackQuery(VOTE_START_CALLBACK, async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.startVote(ctx);
    });

    bot.command('cancel', async (ctx) => {
      const telegramId = ctx.from?.id;
      if (telegramId !== undefined && this.exitSilently !== null) {
        // "Vaqt tugadi" xabari chiqmasligi uchun jimgina chiqamiz.
        await this.exitSilently(ctx, telegramId);
      }
      await ctx.reply('❌ Amal bekor qilindi. Qaytadan boshlash uchun /vote', {
        reply_markup: { remove_keyboard: true },
      });
    });

    bot.command('status', (ctx) => this.showStatus(ctx));

    this.logger.log("Bot handlerlari ro'yxatdan o'tkazildi");
  }

  /**
   * Noma'lum buyruqlar uchun yagona javob.
   *
   * ENG OXIRIDA ulanishi shart: undan oldin ro'yxatdan o'tmagan har qanday
   * buyruq (jumladan admin buyruqlari) shu handler tomonidan yutilib ketardi.
   * Javob admin buyruqlarining rad javobi bilan AYNAN bir xil — buyruq
   * mavjudligi javob farqi orqali oshkor bo'lmasligi kerak.
   */
  registerFallback(bot: Bot<BotContext>): void {
    bot.on('message:text').filter(
      (ctx) =>
        ctx.message.text.startsWith('/') &&
        // Conversation aktiv bo'lsa u `otherwise` bilan allaqachon javob bergan
        // va update'ni downstream'ga ham uzatgan — bu yerda ikkinchi javob
        // yuborsak foydalanuvchi bitta buyruqqa ikkita javob olardi.
        ctx.conversation.active(VOTE_CONVERSATION_ID) === 0,
      async (ctx) => {
        await ctx.reply("❓ Noma'lum buyruq. Yordam uchun /help");
      },
    );
  }

  /**
   * Ovoz berish oqimini boshlaydi.
   * Aktiv conversation ustiga `enter()` chaqirilsa grammY xatolik tashlaydi va
   * foydalanuvchi TTL tugagunicha "qulflanib" qoladi — shuning uchun avval chiqamiz.
   */
  private async startVote(ctx: BotContext): Promise<void> {
    await this.rememberUser(ctx);

    const telegramId = ctx.from?.id;
    if (
      ctx.conversation.active(VOTE_CONVERSATION_ID) > 0 &&
      telegramId !== undefined &&
      this.exitSilently !== null
    ) {
      await this.exitSilently(ctx, telegramId);
    }
    await ctx.conversation.enter(VOTE_CONVERSATION_ID);
  }

  /** Foydalanuvchining oxirgi ovoz urinishlarini ko'rsatadi. */
  private async showStatus(ctx: BotContext): Promise<void> {
    const user = await this.rememberUser(ctx);
    if (user === null) {
      await ctx.reply("⚠️ Ma'lumotlarni olishda xatolik. Birozdan so'ng qayta urinib ko'ring.");
      return;
    }

    const votes = await this.voteService.getByUser(user.id, { take: STATUS_PAGE_SIZE });
    if (votes.length === 0) {
      await ctx.reply("📭 Hali ovoz berish urinishlaringiz yo'q.\nBoshlash uchun /vote");
      return;
    }

    const lines = votes.map(
      (vote) =>
        `• ${this.formatDate(vote.createdAt)} — ${maskPhone(vote.phone)} — ${formatVoteStatus(vote.status)}`,
    );

    await ctx.reply(`📊 <b>Oxirgi urinishlaringiz</b>\n\n${lines.join('\n')}`, {
      parse_mode: 'HTML',
    });
  }

  /** Rasmiy botga deep-link. */
  private officialBotUrl(): string {
    return buildOfficialBotUrl(
      this.configService.getOrThrow<string>('openbudget.officialBot'),
      this.configService.getOrThrow<string>('openbudget.initiativePublicId'),
    );
  }

  /**
   * Sanani foydalanuvchi vaqt mintaqasida yozadi.
   * Server UTC'da ishlagani uchun lokal `getHours()` 5 soat farq berardi.
   */
  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.configService.getOrThrow<string>('app.timeZone'),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(date)
      .replace(/\//g, '.')
      .replace(',', '');
  }

  /** Foydalanuvchini bazaga yozadi/yangilaydi. */
  private async rememberUser(ctx: BotContext) {
    const from = ctx.from;
    if (from === undefined) {
      return null;
    }

    try {
      return await this.userService.findOrCreate(BigInt(from.id), {
        firstName: from.first_name,
        lastName: from.last_name ?? null,
        username: from.username ?? null,
      });
    } catch (error) {
      // Buyruqqa javob berish DB yozuvidan muhimroq.
      this.logger.error(`Foydalanuvchini saqlab bo'lmadi: ${toErrorInfo(error).message}`);
      return null;
    }
  }
}
