import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, BotError, GrammyError, HttpError } from 'grammy';
import type { Update } from 'grammy/types';
import type { BotMode } from '../config/configuration';
import { toErrorInfo } from '../common/utils/error.util';
import { BotThrottle } from './bot.throttle';
import { AdminUpdate } from './admin/admin.update';
import { BotUpdate } from './bot.update';
import type { BotContext } from './bot.types';

/** Telegram API 429/5xx qaytarganda qayta urinish sozlamalari. */
const AUTO_RETRY_MAX_ATTEMPTS = 3;
const AUTO_RETRY_MAX_DELAY_SECONDS = 10;

/** To'xtatishda ishlab turgan handler'larni kutish chegarasi. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly bot: Bot<BotContext>;

  /** Hozir ishlanayotgan update'lar soni — toza to'xtatish uchun. */
  private pendingUpdates = 0;
  private drained: Promise<void> = Promise.resolve();
  private resolveDrained: () => void = () => {};

  constructor(
    private readonly configService: ConfigService,
    private readonly botUpdate: BotUpdate,
    private readonly adminUpdate: AdminUpdate,
    private readonly throttle: BotThrottle,
  ) {
    this.bot = new Bot<BotContext>(this.configService.getOrThrow<string>('bot.token'));
  }

  async onModuleInit(): Promise<void> {
    this.registerMiddlewares();
    this.botUpdate.register(this.bot);
    this.adminUpdate.register(this.bot);
    this.botUpdate.registerFallback(this.bot);
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

    let drainTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.drained,
        new Promise<void>((resolve) => {
          drainTimer = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(drainTimer);
    }

    this.logger.log("Bot to'xtatildi");
  }

  private registerMiddlewares(): void {
    this.bot.api.config.use(
      autoRetry({
        maxRetryAttempts: AUTO_RETRY_MAX_ATTEMPTS,
        maxDelaySeconds: AUTO_RETRY_MAX_DELAY_SECONDS,
      }),
    );

    this.bot.use(async (_ctx, next) => {
      if (this.pendingUpdates++ === 0) {
        this.drained = new Promise<void>((resolve) => {
          this.resolveDrained = resolve;
        });
      }
      try {
        await next();
      } finally {
        if (--this.pendingUpdates === 0) {
          this.resolveDrained();
        }
      }
    });

    // Faqat shaxsiy chatda ishlaydi.
    this.bot.use(async (ctx, next) => {
      if (ctx.chat !== undefined && ctx.chat.type !== 'private') {
        return;
      }
      await next();
    });

    // Flood himoyasi.
    this.bot.use(async (ctx, next) => {
      const telegramId = ctx.from?.id;
      if (telegramId !== undefined && (await this.throttle.isFlooding(telegramId))) {
        return;
      }
      await next();
    });
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
