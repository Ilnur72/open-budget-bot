import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, GrammyError, HttpError } from 'grammy';
import type { Update } from 'grammy/types';
import { toErrorInfo } from '../common/utils/error.util';
import { BotUpdate } from './bot.update';
import type { BotContext } from './bot.types';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly bot: Bot<BotContext>;
  private readonly webhookUrl?: string;
  private readonly secret: string;
  private isPolling = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly botUpdate: BotUpdate,
  ) {
    const token = this.configService.getOrThrow<string>('bot.token');
    this.bot = new Bot<BotContext>(token);
    this.webhookUrl = this.configService.get<string>('bot.webhookUrl');
    this.secret =
      this.configService.get<string>('bot.webhookSecret') ??
      createHash('sha256').update(`wh:${token}`).digest('hex').slice(0, 64);
  }

  async onModuleInit(): Promise<void> {
    this.bot.api.config.use(
      autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }),
    );

    this.bot.use(async (ctx, next) => {
      if (ctx.chat !== undefined && ctx.chat.type !== 'private') {
        return;
      }
      await next();
    });

    this.botUpdate.register(this.bot);
    this.registerErrorHandler();

    if (this.webhookUrl) {
      await this.bot.init();
      await this.bot.api.setWebhook(`${this.webhookUrl}/bot/webhook`, {
        secret_token: this.secret,
      });
      this.logger.log(`Bot ishga tushdi (webhook): @${this.bot.botInfo.username}`);
    } else {
      await this.bot.api.deleteWebhook().catch(() => undefined);
      this.isPolling = true;
      void this.bot
        .start({
          onStart: (info) => this.logger.log(`Bot ishga tushdi: @${info.username}`),
        })
        .catch((error: unknown) => {
          const { message, stack } = toErrorInfo(error);
          this.logger.error(`Bot to'xtadi: ${message}`, stack);
          process.exitCode = 1;
          process.kill(process.pid, 'SIGTERM');
        });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isPolling) {
      await this.bot.stop();
    }
    this.logger.log("Bot to'xtatildi");
  }

  verifySecret(token: string | undefined): boolean {
    return token === this.secret;
  }

  async handleUpdate(update: unknown): Promise<void> {
    await this.bot.handleUpdate(update as Update);
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
        this.logger.error(`Bot xatolik: ${message} [userId=${userId}]`, stack);
      }

      void ctx
        .reply("❌ Kutilmagan xatolik yuz berdi. Qaytadan urinib ko'ring: /vote")
        .catch(() => undefined);
    });
  }
}
