import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';
import { OtpAttemptsExhaustedError } from './openbudget.errors';
import type { CaptchaChallenge, ConfirmableVoteSession, VoteSession } from './openbudget.types';

/**
 * Captcha bosqichi TTL'i.
 * Butun oqimga yetishi kerak: captcha yechish + telefon kiritish, har biri
 * 5 daqiqagacha kutishi mumkin.
 */
const CAPTCHA_TTL_SECONDS = 15 * 60;

/**
 * SMS yuborilgandan keyingi TTL — qisqaroq.
 * `gr_token` maxfiy qiymat, OTP muddati ham baribir cheklangan.
 */
const CONFIRM_TTL_SECONDS = 5 * 60;

/** SMS kodni necha marta kiritishga ruxsat beriladi. */
const MAX_OTP_ATTEMPTS = 3;

const KEY_PREFIX = 'openbudget:session';

/**
 * Ovoz oqimining oraliq holatini Redis'da saqlaydi.
 *
 * `gr_token` bot sessiyasida yoki conversation replay log'ida saqlanmaydi:
 * u qisqa muddatli maxfiy qiymat va alohida qisqa TTL bilan yotishi kerak.
 */
@Injectable()
export class VoteSessionStore {
  private readonly logger = new Logger(VoteSessionStore.name);

  constructor(private readonly redisService: RedisService) {}

  /** Oqim boshida: captcha rasmlari va sessiya cookie'sini saqlaydi. */
  async startCaptcha(telegramId: number, captcha: CaptchaChallenge): Promise<void> {
    await this.write(
      telegramId,
      {
        imageA: captcha.imageA,
        imageB: captcha.imageB,
        ...(captcha.cookie === undefined ? {} : { cookie: captcha.cookie }),
        otpAttempts: 0,
      },
      CAPTCHA_TTL_SECONDS,
    );
    this.logger.debug(`Captcha sessiyasi boshlandi: telegramId=${telegramId}`);
  }

  /** Boshlangan ovoz yozuvini sessiyaga bog'laydi (timeout'da yopish uchun). */
  async attachVote(telegramId: number, voteId: number): Promise<void> {
    const session = await this.get(telegramId);
    if (session === null) {
      return;
    }
    await this.write(telegramId, { ...session, voteId }, await this.remainingTtl(telegramId));
  }

  /** SMS yuborilgach: telefonni va yangilangan cookie'ni saqlaydi. */
  async attachSentCode(telegramId: number, phone: string, cookie?: string): Promise<void> {
    const session = await this.get(telegramId);
    if (session === null) {
      throw new Error('Captcha sessiyasi topilmadi');
    }
    await this.write(
      telegramId,
      { ...session, phone, ...(cookie === undefined ? {} : { cookie }) },
      CONFIRM_TTL_SECONDS,
    );
  }

  /** Sessiyani o'qiydi. Muddati o'tgan, yo'q yoki buzilgan bo'lsa `null`. */
  async get(telegramId: number): Promise<VoteSession | null> {
    const raw = await this.redisService.client.get(this.key(telegramId));
    if (raw === null) {
      return null;
    }

    const session = parseSession(raw);
    if (session === null) {
      // `JSON.parse` o'tsa ham shakli boshqa bo'lishi mumkin — aks holda
      // `undefined` gr_token tashqi API'ga ketardi.
      await this.clear(telegramId);
      this.logger.warn(`Buzilgan ovoz sessiyasi o'chirildi: telegramId=${telegramId}`);
      return null;
    }

    return session;
  }

  /** SMS yuborilgan sessiyani qaytaradi; to'liq bo'lmasa `null`. */
  async getConfirmable(telegramId: number): Promise<ConfirmableVoteSession | null> {
    const session = await this.get(telegramId);
    if (session === null || session.phone === undefined) {
      return null;
    }
    return { ...session, phone: session.phone };
  }

  /**
   * OTP kiritish urinishini hisoblaydi.
   * Urinishlar tugasa sessiya o'chiriladi — aks holda qurbon raqamiga SMS
   * yuborib, kodni brute-force qilish mumkin bo'lardi.
   */
  async consumeOtpAttempt(telegramId: number): Promise<void> {
    const session = await this.get(telegramId);
    if (session === null) {
      throw new OtpAttemptsExhaustedError();
    }

    const attempts = session.otpAttempts + 1;
    // `>` — `>=` bo'lganda konstanta 3 va'da qilib, amalda 2 ta urinish berardi.
    if (attempts > MAX_OTP_ATTEMPTS) {
      await this.clear(telegramId);
      this.logger.warn(`OTP urinishlari tugadi: telegramId=${telegramId}`);
      throw new OtpAttemptsExhaustedError();
    }

    // TTL saqlanadi: sessiya umri urinishlar bilan cho'zilmasin.
    await this.write(
      telegramId,
      { ...session, otpAttempts: attempts },
      await this.remainingTtl(telegramId),
    );
  }

  /** Oqim tugagach yoki bekor qilinganda sessiyani o'chiradi. */
  async clear(telegramId: number): Promise<void> {
    await this.redisService.client.del(this.key(telegramId));
  }

  private async remainingTtl(telegramId: number): Promise<number> {
    const ttl = await this.redisService.client.ttl(this.key(telegramId));
    return ttl > 0 ? ttl : CONFIRM_TTL_SECONDS;
  }

  private async write(telegramId: number, session: VoteSession, ttl: number): Promise<void> {
    await this.redisService.client.set(this.key(telegramId), JSON.stringify(session), 'EX', ttl);
  }

  private key(telegramId: number): string {
    return `${KEY_PREFIX}:${telegramId}`;
  }
}

/** Redis'dan kelgan matnni `VoteSession` shakliga tekshirib aylantiradi. */
function parseSession(raw: string): VoteSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const { cookie, imageA, imageB, phone, otpAttempts, voteId } = record;

  if (typeof imageA !== 'string' || typeof imageB !== 'string') {
    return null;
  }
  if (phone !== undefined && typeof phone !== 'string') {
    return null;
  }
  if (cookie !== undefined && typeof cookie !== 'string') {
    return null;
  }

  return {
    imageA,
    imageB,
    ...(typeof cookie === 'string' ? { cookie } : {}),
    ...(typeof phone === 'string' ? { phone } : {}),
    ...(typeof voteId === 'number' ? { voteId } : {}),
    otpAttempts: typeof otpAttempts === 'number' ? otpAttempts : 0,
  };
}
