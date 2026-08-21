import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { GrammyError } from 'grammy';
import type { Api } from 'grammy';
import { AdminService } from '../../admin/admin.service';
import { toErrorInfo } from '../../common/utils/error.util';

/**
 * Xabarlar orasidagi pauza.
 * Telegram bir xil botdan sekundiga ~30 xabarga ruxsat beradi; 50ms —
 * spetsifikatsiyada ko'rsatilgan xavfsiz tezlik.
 */
const DELAY_BETWEEN_MESSAGES_MS = 50;

/** Foydalanuvchilar shuncha-shuncha qilib DB'dan olinadi. */
const PAGE_SIZE = 500;

/**
 * Ketma-ket shuncha xatolikdan keyin broadcast to'xtatiladi.
 * Masalan buzuq HTML bilan har bir xabar 400 beradi — 50k xabar × 50ms
 * ≈ 42 daqiqa bekorga sarflanardi.
 */
const MAX_CONSECUTIVE_FAILURES = 50;

/** Loglar shuncha xatolikdan keyin yig'ma ko'rinishga o'tadi. */
const VERBOSE_FAILURE_LOGS = 20;
const FAILURE_LOG_INTERVAL = 500;

export interface BroadcastProgress {
  sent: number;
  blocked: number;
  failed: number;
  total: number;
}

/**
 * Barcha foydalanuvchilarga xabar yuboradi.
 *
 * `bot/` qatlamida joylashgan, chunki `Api` ga muhtoj — `AdminService` esa
 * bot haqida hech narsa bilmasligi kerak (aylanma bog'liqlik).
 */
@Injectable()
export class BroadcastService implements OnApplicationShutdown {
  private readonly logger = new Logger(BroadcastService.name);
  private current: Promise<BroadcastProgress> | null = null;
  private aborted = false;
  private consecutiveFailures = 0;

  constructor(private readonly adminService: AdminService) {}

  /** Hozir broadcast ketyaptimi. */
  get isRunning(): boolean {
    return this.current !== null;
  }

  /**
   * Ilova to'xtaganda joriy sahifani tugatib, keyingisiga o'tmaydi.
   *
   * Broadcast middleware zanjiridan tashqarida (fonda) ishlaydi, shuning uchun
   * `BotService` ning drain mexanizmi uni kutmaydi — SIGTERM kelganda u
   * o'rtasidan uzilib, Prisma allaqachon yopilgan bo'lardi.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.current === null) {
      return;
    }
    this.logger.warn("Ilova to'xtayapti — broadcast uziladi");
    this.aborted = true;
    await this.current.catch(() => undefined);
  }

  /**
   * Xabarni bloklanmagan barcha foydalanuvchilarga yuboradi.
   *
   * Botni bloklagan foydalanuvchilar (403) DB'da `isBlocked` deb belgilanadi —
   * keyingi broadcast'da ular bekorga urinilmaydi.
   *
   * @param onProgress har sahifadan keyin chaqiriladi (holat ko'rsatish uchun)
   */
  async broadcast(
    api: Api,
    text: string,
    onProgress?: (progress: BroadcastProgress) => void | Promise<void>,
  ): Promise<BroadcastProgress> {
    if (this.current !== null) {
      throw new Error('Broadcast allaqachon ketmoqda');
    }

    const task = this.run(api, text, onProgress);
    this.current = task;
    return task;
  }

  private async run(
    api: Api,
    text: string,
    onProgress?: (progress: BroadcastProgress) => void | Promise<void>,
  ): Promise<BroadcastProgress> {
    const progress: BroadcastProgress = { sent: 0, blocked: 0, failed: 0, total: 0 };
    this.aborted = false;
    this.consecutiveFailures = 0;

    try {
      let cursor: number | null = null;

      for (;;) {
        if (this.aborted) {
          this.logger.warn(`Broadcast to'xtatildi: ${progress.sent} ta yuborilgan edi`);
          break;
        }

        const users = await this.adminService.getBroadcastTargets(cursor, PAGE_SIZE);
        if (users.length === 0) {
          break;
        }

        for (const user of users) {
          if (this.aborted) {
            // Tekshiruv SIKL ICHIDA ham: faqat sahifalar orasida tekshirsak,
            // 500 xabar × 50ms = kamida 25 soniya kutish kerak bo'lardi va
            // `stop_grace_period` tugab SIGKILL tushardi.
            break;
          }

          progress.total += 1;
          await this.sendOne(api, user, text, progress);

          if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            throw new Error(
              `Ketma-ket ${this.consecutiveFailures} ta xato — broadcast to'xtatildi`,
            );
          }

          await delay(DELAY_BETWEEN_MESSAGES_MS);
        }

        cursor = users[users.length - 1].id;
        await onProgress?.(progress);
      }

      this.logger.log(
        `Broadcast tugadi: yuborildi=${progress.sent}, bloklangan=${progress.blocked}, xato=${progress.failed}`,
      );
      return progress;
    } finally {
      this.current = null;
    }
  }

  /** Bitta foydalanuvchiga yuborish — xatolik butun broadcast'ni to'xtatmasin. */
  private async sendOne(
    api: Api,
    user: { id: number; telegramId: bigint },
    text: string,
    progress: BroadcastProgress,
  ): Promise<void> {
    try {
      await api.sendMessage(Number(user.telegramId), text, { parse_mode: 'HTML' });
      progress.sent += 1;
      this.consecutiveFailures = 0;
    } catch (error) {
      if (isBlockedByUser(error)) {
        progress.blocked += 1;
        this.consecutiveFailures = 0;
        await this.adminService.markBlocked(user.id).catch(() => undefined);
        return;
      }

      progress.failed += 1;
      this.consecutiveFailures += 1;
      this.logFailure(user.id, progress.failed, error);
    }
  }

  /** Loglar cheklanadi: tarmoq tushsa 50k qator log diskni to'ldirardi. */
  private logFailure(userId: number, failedCount: number, error: unknown): void {
    const message = toErrorInfo(error).message;

    if (failedCount <= VERBOSE_FAILURE_LOGS) {
      this.logger.warn(`Broadcast xatosi: userId=${userId}, ${message}`);
    } else if (failedCount % FAILURE_LOG_INTERVAL === 0) {
      this.logger.warn(`Broadcast: ${failedCount} ta xato (oxirgisi: ${message})`);
    }
  }
}

/** Foydalanuvchi botni bloklagan yoki chatni o'chirganmi. */
function isBlockedByUser(error: unknown): boolean {
  if (!(error instanceof GrammyError)) {
    return false;
  }
  // 403 ning barcha sabablari emas — faqat foydalanuvchi tomonidagilar.
  return (
    error.description.includes('bot was blocked') ||
    error.description.includes('user is deactivated') ||
    error.description.includes('chat not found')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
