import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Update } from 'grammy/types';
import { toErrorInfo } from '../common/utils/error.util';
import type { BotMode } from '../config/configuration';
import { BotService } from './bot.service';

/**
 * Telegram webhook endpointi.
 *
 * Yo'lda bot tokeni YO'Q (spetsifikatsiyada shunday taklif qilingan edi):
 * URL nginx va proxy loglariga tushadi, sarlavha esa tushmaydi. Telegram
 * `secret_token` ni aynan shu maqsad uchun beradi.
 */
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    private readonly botService: BotService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  // Telegram javob tanasini o'qimaydi; 200 ni tez qaytarish muhim.
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<void> {
    if (this.configService.getOrThrow<BotMode>('bot.mode') !== 'webhook') {
      throw new UnauthorizedException();
    }

    const expected = this.configService.getOrThrow<string>('bot.webhookSecret');
    if (!isSecretValid(secret, expected)) {
      this.logger.warn("Webhook so'rovi noto'g'ri secret bilan keldi");
      throw new UnauthorizedException();
    }

    // Xatolik yuqoriga CHIQMASLIGI kerak: 5xx qaytarsak Telegram update'ni
    // qayta yuboradi, conversation eski holatdan replay bo'ladi va bir xil amal
    // takrorlanadi. Bundan tashqari Nest'ning global exception filtri xom
    // xatolik obyektini logga yozadi — u yerda bot tokeni bo'lishi mumkin.
    try {
      await this.botService.handleUpdate(update);
    } catch (error) {
      this.logger.error(`Webhook update ishlanmadi: ${toErrorInfo(error).message}`);
    }
  }
}

/** Maxfiy kalitni doimiy vaqtda solishtiradi. */
function isSecretValid(received: string | undefined, expected: string): boolean {
  if (received === undefined) {
    return false;
  }
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
