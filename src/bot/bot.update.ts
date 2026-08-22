import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Bot } from 'grammy';
import { escapeHtml } from '../common/utils/escape-html.util';
import type { BotContext } from './bot.types';
import { buildMainKeyboard, buildOfficialBotUrl } from './keyboards/vote.keyboard';

@Injectable()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(private readonly configService: ConfigService) {}

  register(bot: Bot<BotContext>): void {
    bot.command('start', async (ctx) => {
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
          '1. "🗳 Ovoz berish" tugmasini bosing\n' +
          '2. Rasmiy botda bitta tugma bosib ovoz bering\n\n' +
          '⚠️ Bir telefon raqamdan loyihaga faqat bir marta ovoz berish mumkin.',
        { parse_mode: 'HTML' },
      );
    });

    bot.command('vote', async (ctx) => {
      await ctx.reply('🗳 Ovoz berish uchun pastdagi tugmani bosing:', {
        reply_markup: buildMainKeyboard(this.officialBotUrl()),
      });
    });

    bot.on('message:text').filter(
      (ctx) => ctx.message.text.startsWith('/'),
      async (ctx) => {
        await ctx.reply("❓ Noma'lum buyruq. Yordam uchun /help");
      },
    );

    this.logger.log("Bot handlerlari ro'yxatdan o'tkazildi");
  }

  private officialBotUrl(): string {
    return buildOfficialBotUrl(
      this.configService.getOrThrow<string>('openbudget.officialBot'),
      this.configService.getOrThrow<string>('openbudget.initiativePublicId'),
    );
  }
}
