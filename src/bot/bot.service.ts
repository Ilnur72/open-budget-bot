import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, BotError, GrammyError, HttpError } from 'grammy';
import type { Update } from 'grammy/types';
import type { BotMode } from '../config/configuration';
import { toErrorInfo } from '../common/utils/error.util';
import { BotUpdate } from './bot.update';
import type { BotContext } from './bot.types';

const AUTO_RETRY_MAX_ATTEMPTS = 3;
const AUTO_RETRY_MAX_DELAY_SECONDS = 10;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly bot: Bot<BotContext>;

  constructor(
    private readonly configService: ConfigService,
    private readonly botUpdate: BotUpdate,
  ) {
    this.bot = new Bot<BotContext>(this.configService.getOrThrow<string>('bot.token'));
  }

  async onModuleInit(): Promise<void> {
    this.bot.api.config.use(
      autoRetry({
        maxRetryAttempts: AUTO_RETRY_MAX_ATTEMPTS,
        maxDelaySeconds: AUTO_RETRY_MAX_DELAY_SECONDS,
      }),
    );

    // Faqat shaxsiy chatda ishlaydi.
    this.bot.use(async (ctx, next) => {
      if (ctx.chat !== undefined && ctx.chat.type !== 'private') {
        return;
      }
      await next();
    });

    this.botUpdate.register(this.bot);
    this.registerErrorHandler();

    await this.bot.init();

    if (this.configService.getOrThrow<BotMode>('bot.mode') === 'webhook') {
      await this.startWebhook();
      return;
    }

    await this.startPolling();
  }

  private async startWebhook(): Promise<void> {
    const url = this.configService.getOrThrow<string>('bot.webhookUrl');
    const secret = this.configService.getOrThrow<string>('bot.webhookSecret');

    await this.bot.api.setWebhook(url, {
      secret_token: secret,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query'],
    });

    this.logger.log(`Webhook o'rnatildi: @${this.bot.botInfo.username}`);
  }

  private async startPolling(): Promise<void> {
    await this.bot.api.deleteWebhook().catch(() => undefined);

    void this.bot
      .start({
        onStart: (info) => this.logger.log(`Bot ishga tushdi: @${info.username}`),
      })
      .catch((error: unknown) => {
        const { message, stack } = toErrorInfo(error);
        this.logger.error(`Bot long-polling to'xtadi: ${message}`, stack);
        process.exitCode = 1;
        process.kill(process.pid, 'SIGTERM');
      });
  }

  async handleUpdate(update: Update): Promise<void> {
    try {
      await this.bot.handleUpdate(update);
    } catch (error) {
      if (error instanceof BotError) {
        await this.bot.errorHandler(error as BotError<BotContext>);
        return;
      }
      const { message, stack } = toErrorInfo(error);
      this.logger.error(`Webhook update ishlanmadi: ${message}`, stack);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot.stop();
    this.logger.log("Bot to'xtatildi");
  }

  private registerErrorHandler(): void {
    this.bot.catch((err) => {
      const { ctx } = err;
      const cause = err.error;
      const userId = ctx.from?.id;

      if (cause instanceof GrammyError) {
        this.logger.error(
          `Telegram API xatolik (${cause.method}): ${cause.description} [userId=${userId}]`,
        );
      } else if (cause instanceof HttpError) {
        this.logger.error(`Telegram bilan aloqa uzildi: ${cause.message} [userId=${userId}]`);
      } else {
        const { message, stack } = toErrorInfo(cause);
        this.logger.error(
          `Bot xatolik: ${message} [userId=${userId}, updateId=${ctx.update.update_id}]`,
          stack,
        );
      }

      void ctx
        .reply("❌ Kutilmagan xatolik yuz berdi. Qaytadan urinib ko'ring: /vote")
        .catch(() => undefined);
    });
  }
}
