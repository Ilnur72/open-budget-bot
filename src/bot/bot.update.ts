import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Bot } from 'grammy';
import { toErrorInfo } from '../common/utils/error.util';
import { escapeHtml } from '../common/utils/escape-html.util';
import { UserService } from '../user/user.service';
import type { BotContext } from './bot.types';
import { buildMainKeyboard, buildOfficialBotUrl } from './keyboards/vote.keyboard';

@Injectable()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  register(bot: Bot<BotContext>): void {
    bot.command('start', async (ctx) => {
      await this.rememberUser(ctx);
      await ctx.reply(
        `👋 <b>Assalomu alaykum, ${escapeHtml(ctx.from?.first_name ?? 'foydalanuvchi')}!</b>\n\n` +
          '🗳 Mahallamiz loyihasiga ovoz berish uchun bot.\n\n' +
          'Pastdagi tugmani bosing — rasmiy Ochiq Byudjet botiga o\'tasiz va ' +
          'faqat <b>bitta tugma</b> bosib ovoz berasiz.\n' +
          'Captcha ham, SMS ham kerak emas!',
        { parse_mode: 'HTML', reply_markup: buildMainKeyboard(this.officialBotUrl()) },
      );
    });

    bot.command('help', async (ctx) => {
      await ctx.reply(
        '❓ <b>Yordam</b>\n\n' +
          'Ovoz berish tartibi:\n' +
          '1. Pastdagi "🗳 Ovoz berish" tugmasini bosing\n' +
          '2. Rasmiy botda bitta tugma bosib ovoz bering\n\n' +
          '⚠️ Bir telefon raqamdan loyihaga faqat bir marta ovoz berish mumkin.',
        { parse_mode: 'HTML' },
      );
    });

    bot.command('vote', async (ctx) => {
      await this.rememberUser(ctx);
      await ctx.reply('🗳 Ovoz berish uchun pastdagi tugmani bosing:', {
        reply_markup: buildMainKeyboard(this.officialBotUrl()),
      });
    });

    this.logger.log("Bot handlerlari ro'yxatdan o'tkazildi");
  }

  registerFallback(bot: Bot<BotContext>): void {
    bot.on('message:text').filter(
      (ctx) => ctx.message.text.startsWith('/'),
      async (ctx) => {
        await ctx.reply("❓ Noma'lum buyruq. Yordam uchun /help");
      },
    );
  }

  private officialBotUrl(): string {
    return buildOfficialBotUrl(
      this.configService.getOrThrow<string>('openbudget.officialBot'),
      this.configService.getOrThrow<string>('openbudget.initiativePublicId'),
    );
  }

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
      this.logger.error(`Foydalanuvchini saqlab bo'lmadi: ${toErrorInfo(error).message}`);
      return null;
    }
  }
}
