import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';
import { maskPhone } from '../common/utils/mask-phone.util';
import { formatUzPhone, isValidUzPhone } from '../common/utils/phone.util';
import {
  CaptchaQuotaExceededError,
  ManualPhoneQuotaExceededError,
  PhoneRateLimitedError,
  RateLimiterUnavailableError,
  UserQuotaExceededError,
} from './openbudget.errors';
import { InvalidPhoneError } from '../vote/vote.errors';

/** Sayt cheklovi: bir raqamdan kuniga bitta ovoz. */
const SMS_PER_PHONE_PER_DAY = 1;

/**
 * Bitta Telegram foydalanuvchisi kuniga nechta har xil raqam kirita oladi.
 * Telefon bo'yicha limit yolg'iz o'zi yetarli emas: bir akkaunt minglab
 * begona raqam kiritib, ularga SMS yog'dirishi mumkin edi.
 */
const PHONES_PER_USER_PER_DAY = 3;

/**
 * Shundan nechtasi QO'LDA kiritilgan bo'lishi mumkin.
 *
 * Kontakt tugmasida raqam egaligini Telegram tasdiqlaydi, qo'lda kiritishda esa
 * yo'q — ya'ni begona raqamga SMS yuborish faqat shu yo'l orqali mumkin.
 * Qo'lda kiritish ikkala hisoblagichni ham sarflaydi, shuning uchun kunlik
 * umumiy chegara baribir 3 bo'lib qoladi.
 */
const MANUAL_PHONES_PER_USER_PER_DAY = 1;

/** Telefon raqam qayerdan kelgani. */
export type PhoneSource = 'contact' | 'manual';

/**
 * Captcha so'rovlari uchun alohida, qattiqroq limit.
 * `getCaptcha()` har chaqirilganda openbudget.uz ga so'rov ketadi — bir nechta
 * akkaunt bilan uni bombardimon qilib, IP ban olish mumkin edi.
 */
const CAPTCHA_PER_USER_PER_HOUR = 5;
const CAPTCHA_WINDOW_SECONDS = 60 * 60;

const WINDOW_SECONDS = 24 * 60 * 60;

const PHONE_KEY_PREFIX = 'openbudget:ratelimit:phone';
const USER_KEY_PREFIX = 'openbudget:ratelimit:user';
const CAPTCHA_KEY_PREFIX = 'openbudget:ratelimit:captcha';
const MANUAL_KEY_PREFIX = 'openbudget:ratelimit:manual';

/**
 * Ovoz urinishlarini telefon va Telegram foydalanuvchisi bo'yicha cheklaydi.
 *
 * Muhim: Redis javobini o'qib bo'lmasa ruxsat BERILMAYDI (fail-closed).
 * Aks holda Redis nosozligi limitni butunlay o'chirib qo'yardi.
 */
@Injectable()
export class VoteRateLimiter {
  private readonly logger = new Logger(VoteRateLimiter.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Telefon bo'yicha kunlik SMS limitini ishlatadi.
   * Limit tugagan bo'lsa `PhoneRateLimitedError` tashlaydi.
   */
  async consumePhone(phone: string): Promise<void> {
    const normalized = formatUzPhone(phone);
    // Validatsiyasiz turli "shakl"lar har biri alohida kalit bo'lib,
    // limitni chetlab o'tishga imkon berardi.
    if (!isValidUzPhone(normalized)) {
      throw new InvalidPhoneError(maskPhone(phone));
    }

    const key = `${PHONE_KEY_PREFIX}:${normalized}`;
    const used = await this.increment(key);

    if (used > SMS_PER_PHONE_PER_DAY) {
      // Rad etilgan urinish hisoblagichni shishirmasin: aks holda keyingi
      // haqiqiy refund qiymatni 1 dan pastga tushira olmay qolardi va
      // foydalanuvchi ovoz bermagan holda 24 soatga qulflanib qolardi.
      await this.redisService.client.decr(key);
      this.logger.warn(`Kunlik telefon limiti tugadi: phone=${maskPhone(normalized)}`);
      throw new PhoneRateLimitedError(await this.ttl(key));
    }
  }

  /**
   * Telegram foydalanuvchisining kunlik raqamlar kvotasini ishlatadi.
   *
   * Qo'lda kiritilgan raqam ikkala hisoblagichni sarflaydi: umumiy kvota
   * oshib ketmasligi uchun. Manba limiti buzilsa umumiy hisoblagich qaytariladi.
   */
  async consumeUser(telegramId: number, source: PhoneSource): Promise<void> {
    const userKey = `${USER_KEY_PREFIX}:${telegramId}`;
    const used = await this.increment(userKey);

    if (used > PHONES_PER_USER_PER_DAY) {
      await this.redisService.client.decr(userKey);
      this.logger.warn(`Kunlik foydalanuvchi kvotasi tugadi: telegramId=${telegramId}`);
      throw new UserQuotaExceededError(await this.ttl(userKey));
    }

    if (source !== 'manual') {
      return;
    }

    const manualKey = `${MANUAL_KEY_PREFIX}:${telegramId}`;
    const manualUsed = await this.increment(manualKey).catch(async (error: unknown) => {
      await this.redisService.client.decr(userKey);
      throw error;
    });

    if (manualUsed > MANUAL_PHONES_PER_USER_PER_DAY) {
      await this.redisService.client.decr(manualKey);
      await this.redisService.client.decr(userKey);
      this.logger.warn(`Qo'lda kiritish kvotasi tugadi: telegramId=${telegramId}`);
      throw new ManualPhoneQuotaExceededError(await this.ttl(manualKey));
    }
  }

  /** Captcha so'rovlari uchun soatlik limit. */
  async consumeCaptcha(telegramId: number): Promise<void> {
    const key = `${CAPTCHA_KEY_PREFIX}:${telegramId}`;
    const used = await this.increment(key, CAPTCHA_WINDOW_SECONDS);

    if (used > CAPTCHA_PER_USER_PER_HOUR) {
      await this.redisService.client.decr(key);
      this.logger.warn(`Captcha limiti tugadi: telegramId=${telegramId}`);
      throw new CaptchaQuotaExceededError(await this.ttl(key, CAPTCHA_WINDOW_SECONDS));
    }
  }

  /**
   * Telefon hisoblagichini qaytaradi.
   *
   * FAQAT so'rov serverga umuman yetib bormaganida chaqiriladi (masalan
   * `ECONNREFUSED`). SMS yuborilgandan keyin HECH QACHON chaqirilmasin —
   * aks holda foydalanuvchi ataylab noto'g'ri OTP kiritib yoki oqimni bekor
   * qilib, limitni cheksiz tiklab olardi.
   */
  async refundUndeliveredSms(phone: string): Promise<void> {
    const key = `${PHONE_KEY_PREFIX}:${formatUzPhone(phone)}`;
    const remaining = await this.redisService.client.decr(key);
    if (remaining <= 0) {
      await this.redisService.client.del(key);
    }
  }

  /** Limitni o'zgartirmasdan tekshiradi. */
  async isPhoneExhausted(phone: string): Promise<boolean> {
    const used = await this.redisService.client.get(`${PHONE_KEY_PREFIX}:${formatUzPhone(phone)}`);
    return Number(used ?? 0) >= SMS_PER_PHONE_PER_DAY;
  }

  /**
   * `INCR` + `EXPIRE NX` ni bitta tranzaksiyada bajaradi.
   * Natijani ishonchli o'qib bo'lmasa xatolik tashlaydi (fail-closed).
   */
  private async increment(key: string, windowSeconds = WINDOW_SECONDS): Promise<number> {
    const results = await this.redisService.client
      .multi()
      .incr(key)
      .expire(key, windowSeconds, 'NX')
      .exec();

    if (results === null) {
      throw new RateLimiterUnavailableError('Redis tranzaksiyasi bajarilmadi');
    }

    const [incrError, incrValue] = results[0] ?? [];
    if (incrError) {
      throw new RateLimiterUnavailableError(incrError.message);
    }
    if (typeof incrValue !== 'number') {
      throw new RateLimiterUnavailableError('Redis kutilmagan javob qaytardi');
    }

    // `EXPIRE ... NX` Redis 7.0+ talab qiladi. Eski versiyada u xato beradi,
    // lekin MULTI rollback qilmaydi — kalit TTL'siz qolib, raqam abadiy
    // bloklanardi. Shuning uchun xatoni yutmasdan zaxira yo'lga o'tamiz.
    const [expireError] = results[1] ?? [];
    if (expireError) {
      this.logger.error(`TTL o'rnatilmadi (Redis 7.0+ kerak): ${expireError.message}`);
      await this.redisService.client.expire(key, windowSeconds);
    }

    return incrValue;
  }

  private async ttl(key: string, fallback = WINDOW_SECONDS): Promise<number> {
    const ttl = await this.redisService.client.ttl(key);
    return ttl > 0 ? ttl : fallback;
  }
}
