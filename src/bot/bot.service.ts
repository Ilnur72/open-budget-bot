import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { autoRetry } from '@grammyjs/auto-retry';
import {
  type ConversationData,
  type VersionedState,
  conversations,
  createConversation,
} from '@grammyjs/conversations';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { Bot, BotError, GrammyError, HttpError } from 'grammy';
import type { Update } from 'grammy/types';
import type { BotMode } from '../config/configuration';
import { RedisService } from '../common/redis/redis.service';
import { toErrorInfo } from '../common/utils/error.util';
import { classifyError, toUserMessage } from './bot.messages';
import { BotThrottle } from './bot.throttle';
import { AdminUpdate } from './admin/admin.update';
import { BotUpdate } from './bot.update';
import type { BotContext, ConversationContext } from './bot.types';
import {
  VOTE_CONVERSATION_ID,
  VOTE_CONVERSATION_TIMEOUT_MS,
  createVoteConversation,
} from './conversations/vote.conversation';
import { VoteFlowService } from './vote-flow.service';

/**
 * Conversation replay log TTL'i.
 *
 * grammY conversations v2 qabul qilingan update'larni qayta ijro etish uchun
 * saqlaydi — foydalanuvchi yuborgan telefon raqam va SMS kod matni ham shu
 * logga tushadi. Shuning uchun u oqim davomiyligidan uzoq yashamasligi kerak.
 */
const CONVERSATION_TTL_SECONDS = 15 * 60;

/**
 * Conversation state versiyasi. `vote.conversation.ts` mantiqi o'zgarganda
 * oshiring — aks holda deploy paytida Redis'dagi eski replay log yangi kod
 * bilan qayta ijro etilib, oqim buziladi.
 */
const CONVERSATION_STATE_VERSION = 2;

/**
 * Redis kalit prefiksi.
 * MAJBURIY: conversations storage default'da `String(ctx.chatId)` ni prefikssiz
 * ishlatadi va boshqa har qanday grammY storage bilan to'qnashadi.
 */
const CONVERSATION_KEY_PREFIX = 'convo:';

/** Telegram API 429/5xx qaytarganda qayta urinish sozlamalari. */
const AUTO_RETRY_MAX_ATTEMPTS = 3;
const AUTO_RETRY_MAX_DELAY_SECONDS = 10;

/** To'xtatishda ishlab turgan handler'larni kutish chegarasi. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

/**
 * grammY bot instansiyasini yaratadi, middleware'larni ulaydi va
 * long-polling rejimida ishga tushiradi (webhook'ga keyinroq o'tiladi).
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly bot: Bot<BotContext>;

  /** Hozir ishlanayotgan update'lar soni — toza to'xtatish uchun. */
  private pendingUpdates = 0;
  private drained: Promise<void> = Promise.resolve();
  private resolveDrained: () => void = () => {};

  /**
   * `/cancel` va qayta `/vote` da conversation'dan chiqamiz, lekin `onExit`
   * ham chaqiriladi. Bu to'plam "timeout xabarini yuborma" degan belgi —
   * aks holda foydalanuvchi bekor qilganda "vaqt tugadi" deb yozilardi.
   */
  private readonly silentExits = new Set<number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly botUpdate: BotUpdate,
    private readonly adminUpdate: AdminUpdate,
    private readonly voteFlow: VoteFlowService,
    private readonly throttle: BotThrottle,
  ) {
    this.bot = new Bot<BotContext>(this.configService.getOrThrow<string>('bot.token'));
  }

  /** Conversation'dan xabar yubormasdan chiqish (bekor qilish, qayta boshlash). */
  async exitSilently(ctx: BotContext, telegramId: number): Promise<void> {
    this.silentExits.add(telegramId);
    try {
      await ctx.conversation.exit(VOTE_CONVERSATION_ID);
    } finally {
      this.silentExits.delete(telegramId);
    }
  }

  async onModuleInit(): Promise<void> {
    this.registerMiddlewares();
    this.botUpdate.register(this.bot, this);
    this.adminUpdate.register(this.bot);
    // Fallback ENG OXIRIDA — aks holda u admin buyruqlarini yutib yuborardi.
    this.botUpdate.registerFallback(this.bot);
    this.registerErrorHandler();

    // init() `getMe` chaqiradi — token yoki tarmoq noto'g'ri bo'lsa shu yerda yiqiladi.
    await this.bot.init();

    if (this.configService.getOrThrow<BotMode>('bot.mode') === 'webhook') {
      await this.startWebhook();
      return;
    }

    await this.startPolling();
  }

  /**
   * Webhook rejimi: Telegram update'larni bizga yuboradi.
   * Update'lar `TelegramWebhookController` orqali `handleUpdate()` ga tushadi.
   */
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

  /** Long-polling rejimi (development uchun). */
  private async startPolling(): Promise<void> {
    // Oldingi deploy webhook o'rnatgan bo'lsa polling ishlamaydi — tozalaymiz.
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

  /**
   * Webhook controlleri kelgan update'ni shu orqali beradi.
   *
   * grammY `handleUpdate()` (birlik) xatolikni O'ZI USHLAMAYDI — `errorHandler`
   * faqat long-polling yo'lida chaqiriladi (`grammy/out/bot.js:200`). Shuning
   * uchun `bot.catch` webhook rejimida ishlashi uchun uni qo'lda chaqiramiz.
   */
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
    // Webhook rejimida `stop()` polling'ni to'xtatadi (u yo'q), lekin zararsiz.
    // stop() middleware stack tugashini KUTMAYDI — shuning uchun o'zimiz kutamiz.
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

  /** Middleware'larni tartib bilan ulaydi. */
  private registerMiddlewares(): void {
    this.bot.api.config.use(
      autoRetry({
        maxRetryAttempts: AUTO_RETRY_MAX_ATTEMPTS,
        maxDelaySeconds: AUTO_RETRY_MAX_DELAY_SECONDS,
      }),
    );

    // Eng birinchi — ishlanayotgan update'larni sanaydi (toza to'xtatish uchun).
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

    // Bot faqat shaxsiy chatda ishlaydi: conversation holati chat bo'yicha
    // kalitlanadi, guruhda esa boshqa a'zo birovning oqimini haydab yuborardi.
    this.bot.use(async (ctx, next) => {
      if (ctx.chat !== undefined && ctx.chat.type !== 'private') {
        return;
      }
      await next();
    });

    // Flood himoyasi — javob bermaymiz, aks holda flood kuchayadi.
    this.bot.use(async (ctx, next) => {
      const telegramId = ctx.from?.id;
      if (telegramId !== undefined && (await this.throttle.isFlooding(telegramId))) {
        return;
      }
      await next();
    });

    // DIQQAT: `session()` middleware ATAYLAB yo'q. `ctx.session` hech qayerda
    // kerak emas, u esa conversations bilan bir xil Redis kalitiga yozib,
    // har chatning ikkinchi buyrug'idan keyin holatni buzardi.
    this.bot.use(
      conversations<BotContext, ConversationContext>({
        onExit: (id, exitCtx) => this.handleConversationExit(id, exitCtx),
        storage: {
          type: 'key',
          version: CONVERSATION_STATE_VERSION,
          prefix: CONVERSATION_KEY_PREFIX,
          adapter: new RedisAdapter<VersionedState<ConversationData>>({
            instance: this.redisService.client,
            ttl: CONVERSATION_TTL_SECONDS,
          }),
        },
      }),
    );

    this.bot.use(
      createConversation(
        createVoteConversation({
          voteFlow: this.voteFlow,
          webappUrl: this.configService.getOrThrow<string>('bot.webappUrl'),
        }),
        {
          id: VOTE_CONVERSATION_ID,
          // Talab: 5 daqiqa javob kelmasa oqim bekor bo'lsin.
          maxMillisecondsToWait: VOTE_CONVERSATION_TIMEOUT_MS,
        },
      ),
    );
  }

  /** Conversation to'xtaganda holatni tozalaydi va foydalanuvchini ogohlantiradi. */
  private async handleConversationExit(id: string, exitCtx: BotContext): Promise<void> {
    const telegramId = exitCtx.from?.id;
    if (id !== VOTE_CONVERSATION_ID || telegramId === undefined) {
      return;
    }

    const silent = this.silentExits.has(telegramId);
    await this.voteFlow.cancel(telegramId, silent ? 'CANCELLED' : 'TIMEOUT').catch(() => undefined);

    if (silent) {
      return;
    }

    await exitCtx
      .reply('⌛️ Vaqt tugadi, ovoz berish bekor qilindi.\nQaytadan boshlash uchun /vote')
      .catch(() => undefined);
  }

  /** Ushlanmagan xatoliklar botni yiqitmasligi uchun global handler. */
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

      void ctx.reply(toUserMessage(classifyError(cause)), { parse_mode: 'HTML' }).catch(() => {
        // Foydalanuvchi botni bloklagan bo'lishi mumkin — e'tiborsiz qoldiramiz.
      });
    });
  }
}
