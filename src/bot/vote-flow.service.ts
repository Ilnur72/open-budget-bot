import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoteStatus } from '@prisma/client';
import { toErrorInfo } from '../common/utils/error.util';
import { maskPhone } from '../common/utils/mask-phone.util';
import { VoteSessionExpiredError, isPreSendFailure } from '../openbudget/openbudget.errors';
import { OpenBudgetService } from '../openbudget/openbudget.service';
import type { CaptchaPoint } from '../openbudget/openbudget.types';
import { VoteRateLimiter, type PhoneSource } from '../openbudget/vote-rate-limiter.service';
import { VoteSessionStore } from '../openbudget/vote-session.store';
import { UserService, type TelegramProfile } from '../user/user.service';
import { DuplicateVoteError, InvalidPhoneError } from '../vote/vote.errors';
import { VoteService } from '../vote/vote.service';
import { classifyError } from './bot.messages';
import { ok, type FlowResult } from './flow-result';

/**
 * Boshlangan ovozga havola.
 * Faqat maxfiy bo'lmagan ID'lar — conversation replay log'iga tushishi xavfsiz.
 */
export interface VoteRef {
  voteId: number;
  userId: number;
}

/**
 * Ovoz berish oqimining barcha yon ta'sirlari.
 *
 * Metodlar xatolik TASHLAMAYDI, `FlowResult` qaytaradi. Sabab:
 * `conversation.external()` qaytgan qiymatni `structuredClone` qiladi, u esa
 * `Error` merosxo'rlarini oddiy `Error` ga tushiradi (prototip yo'qoladi,
 * `name` "Error" bo'ladi, custom maydonlar o'chadi). Oddiy obyekt esa
 * klonlashdan ham, Redis JSON round-trip'idan ham o'zgarmasdan chiqadi.
 */
@Injectable()
export class VoteFlowService {
  private readonly logger = new Logger(VoteFlowService.name);

  constructor(
    private readonly openBudget: OpenBudgetService,
    private readonly sessionStore: VoteSessionStore,
    private readonly rateLimiter: VoteRateLimiter,
    private readonly userService: UserService,
    private readonly voteService: VoteService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Oqim boshi: captcha oladi va uni sessiyaga to'liq yozadi.
   * Rasmlar ham saqlanadi — WebApp (05-bosqich) ularni shu sessiyadan olishi
   * kerak, aks holda qayta so'ralgan captcha boshqa kalit bilan keladi.
   */
  async prepareCaptcha(telegramId: number): Promise<FlowResult<null>> {
    try {
      await this.rateLimiter.consumeCaptcha(telegramId);
      const captcha = await this.openBudget.getCaptcha();
      await this.sessionStore.startCaptcha(telegramId, captcha);
      return ok(null);
    } catch (error) {
      this.logger.warn(`Captcha olinmadi: telegramId=${telegramId}`);
      return { ok: false, failure: classifyError(error) };
    }
  }

  /**
   * Telefon va captcha yechimini yuboradi — foydalanuvchiga SMS keladi.
   * Qaytaradigan qiymatda maxfiy narsa yo'q (faqat ID'lar).
   */
  async sendCode(
    telegramId: number,
    profile: TelegramProfile,
    rawPhone: string,
    source: PhoneSource,
    points: CaptchaPoint[],
  ): Promise<FlowResult<VoteRef>> {
    try {
      return ok(await this.runSendCode(telegramId, profile, rawPhone, source, points));
    } catch (error) {
      return { ok: false, failure: classifyError(error) };
    }
  }

  /** SMS kodni tasdiqlaydi va ovozni yakunlaydi. */
  async confirmOtp(telegramId: number, ref: VoteRef, otpCode: string): Promise<FlowResult<null>> {
    try {
      await this.sessionStore.consumeOtpAttempt(telegramId);

      const session = await this.sessionStore.getConfirmable(telegramId);
      if (session === null) {
        throw new VoteSessionExpiredError();
      }

      await this.openBudget.verifyOtp(otpCode, session.cookie);
      await this.voteService.updateStatus(ref.voteId, VoteStatus.SUCCESS);
      await this.sessionStore.clear(telegramId);
      await this.voteService.logAction(ref.userId, 'VOTE_SUCCESS').catch(() => undefined);

      this.logger.log(`Ovoz yakunlandi: voteId=${ref.voteId}, telegramId=${telegramId}`);
      return ok(null);
    } catch (error) {
      const { message } = toErrorInfo(error);
      await this.voteService
        .logAction(ref.userId, 'VOTE_FAILED', { reason: message })
        .catch(() => undefined);
      return { ok: false, failure: classifyError(error) };
    }
  }

  /**
   * Oqim bekor qilinganda yoki muddati o'tganda tozalaydi.
   * Ovoz yozuvi sessiyadan topiladi — chaqiruvchida `voteId` bo'lmasligi mumkin.
   */
  async cancel(telegramId: number, reason = 'CANCELLED'): Promise<void> {
    const session = await this.sessionStore.get(telegramId).catch(() => null);
    await this.sessionStore.clear(telegramId).catch(() => undefined);

    if (session?.voteId !== undefined) {
      // Yozuv PENDING/CODE_SENT holatida qotib qolmasin — statistikani shishiradi.
      await this.voteService
        .updateStatus(session.voteId, VoteStatus.FAILED, reason)
        .catch((error: unknown) => {
          this.logger.warn(`Ovoz holatini yopib bo'lmadi: ${toErrorInfo(error).message}`);
        });
    }
  }

  /** `sendCode` ning asosiy mantiqi — xatoliklar yuqorida tasniflanadi. */
  private async runSendCode(
    telegramId: number,
    profile: TelegramProfile,
    rawPhone: string,
    source: PhoneSource,
    points: CaptchaPoint[],
  ): Promise<VoteRef> {
    const session = await this.sessionStore.get(telegramId);
    if (session === null) {
      throw new VoteSessionExpiredError();
    }

    const phone = this.openBudget.formatPhone(rawPhone);
    if (!this.openBudget.isValidPhone(phone)) {
      throw new InvalidPhoneError(maskPhone(rawPhone));
    }

    // Captcha nuqtalari kvota sarflanishidan OLDIN tekshiriladi: aks holda
    // buzuq yechim yuborib, qurbon raqamini SMS'siz 24 soatga bloklash mumkin edi.
    this.openBudget.assertValidPoints(points);

    const initiativeUuid = this.configService.getOrThrow<string>('openbudget.initiativeUuid');
    const districtId = this.configService.getOrThrow<number>('openbudget.districtId');

    if (await this.voteService.hasSuccessfulVote(phone, initiativeUuid)) {
      throw new DuplicateVoteError(initiativeUuid);
    }

    await this.rateLimiter.consumeUser(telegramId, source);
    await this.rateLimiter.consumePhone(phone);

    const user = await this.userService.findOrCreate(BigInt(telegramId), profile);
    const vote = await this.voteService.create(user.id, phone, initiativeUuid, districtId);
    await this.sessionStore.attachVote(telegramId, vote.id);
    await this.voteService.logAction(user.id, 'CAPTCHA_REQUESTED').catch(() => undefined);

    try {
      const result = await this.openBudget.sendCode(phone, points, session.cookie);

      // ⚠️ Shu nuqtadan keyin SMS KETDI — oqimni ikkilamchi xatolar to'xtatmasin.
      await this.sessionStore.attachSentCode(telegramId, phone, result.cookie);
      await this.voteService.updateStatus(vote.id, VoteStatus.CODE_SENT);
      await Promise.allSettled([
        this.voteService.logAction(user.id, 'CODE_SENT', { phone }),
        this.userService.updatePhone(user.id, phone),
      ]);

      return { voteId: vote.id, userId: user.id };
    } catch (error) {
      // SMS ketmaganiga ISHONCH bo'lgandagina limitni qaytaramiz.
      if (isPreSendFailure(error)) {
        await this.rateLimiter.refundUndeliveredSms(phone).catch(() => undefined);
      }

      const { message } = toErrorInfo(error);
      await this.voteService
        .updateStatus(vote.id, VoteStatus.FAILED, message)
        .catch(() => undefined);
      await this.voteService
        .logAction(user.id, 'VOTE_FAILED', { reason: message })
        .catch(() => undefined);
      throw error;
    }
  }
}
