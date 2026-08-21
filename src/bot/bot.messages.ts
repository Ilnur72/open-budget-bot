import { VoteStatus } from '@prisma/client';
import {
  CaptchaQuotaExceededError,
  CaptchaRejectedError,
  InvalidCaptchaPointsError,
  ManualPhoneQuotaExceededError,
  InvalidOtpError,
  InvalidOtpFormatError,
  OpenBudgetApiError,
  OpenBudgetUnavailableError,
  OtpAttemptsExhaustedError,
  PhoneRateLimitedError,
  RateLimiterUnavailableError,
  UserQuotaExceededError,
  VoteSessionExpiredError,
} from '../openbudget/openbudget.errors';
import { DuplicateVoteError, InvalidPhoneError } from '../vote/vote.errors';
import type { FlowFailure } from './flow-result';

/** Xatolik obyektini oqim kodiga aylantiradi (servis chegarasida chaqiriladi). */
export function classifyError(error: unknown): FlowFailure {
  if (error instanceof InvalidPhoneError) {
    return { code: 'INVALID_PHONE' };
  }
  if (error instanceof DuplicateVoteError) {
    return { code: 'DUPLICATE_VOTE' };
  }
  if (error instanceof PhoneRateLimitedError) {
    return { code: 'PHONE_RATE_LIMITED', retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof UserQuotaExceededError) {
    return { code: 'USER_QUOTA_EXCEEDED', retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof ManualPhoneQuotaExceededError) {
    return { code: 'MANUAL_QUOTA_EXCEEDED', retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof CaptchaQuotaExceededError) {
    return { code: 'CAPTCHA_QUOTA_EXCEEDED', retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof OtpAttemptsExhaustedError) {
    return { code: 'OTP_ATTEMPTS_EXHAUSTED' };
  }
  if (error instanceof InvalidOtpFormatError) {
    return { code: 'INVALID_OTP_FORMAT' };
  }
  if (error instanceof InvalidOtpError) {
    return { code: 'INVALID_OTP' };
  }
  if (error instanceof CaptchaRejectedError || error instanceof InvalidCaptchaPointsError) {
    return { code: 'CAPTCHA_REJECTED' };
  }
  if (error instanceof VoteSessionExpiredError) {
    return { code: 'SESSION_EXPIRED' };
  }
  if (error instanceof OpenBudgetUnavailableError) {
    return { code: 'SERVICE_UNAVAILABLE' };
  }
  if (error instanceof RateLimiterUnavailableError) {
    return { code: 'SERVICE_DEGRADED' };
  }
  if (error instanceof OpenBudgetApiError) {
    return { code: 'API_ERROR' };
  }
  return { code: 'UNKNOWN' };
}

/**
 * Oqim xatoligini foydalanuvchiga ko'rsatiladigan o'zbekcha matnga aylantiradi.
 *
 * Tashqi saytdan kelgan `detail` matni ATAYLAB ishlatilmaydi — u boshqarilmaydigan
 * kirish va Telegram formatlashini buzishi yoki chalg'ituvchi bo'lishi mumkin.
 */
export function toUserMessage(failure: FlowFailure): string {
  switch (failure.code) {
    case 'INVALID_PHONE':
      return "❌ Telefon raqam noto'g'ri. Namuna: <code>901234567</code>";
    case 'DUPLICATE_VOTE':
      return '⚠️ Bu telefon raqamdan ushbu loyihaga allaqachon ovoz berilgan.';
    case 'PHONE_RATE_LIMITED':
      return `⏳ Bu raqamdan bugun allaqachon urinildi. ${formatWait(failure.retryAfterSeconds)} keyin qayta urinib ko'ring.`;
    case 'USER_QUOTA_EXCEEDED':
      return `⏳ Bugungi urinishlar soni tugadi. ${formatWait(failure.retryAfterSeconds)} keyin qayta urinib ko'ring.`;
    case 'MANUAL_QUOTA_EXCEEDED':
      return (
        `⏳ Bugun qo'lda kiritish limiti tugadi (kuniga 1 ta raqam).\n` +
        `📞 O'z raqamingiz uchun "Raqamimni yuborish" tugmasidan foydalaning, ` +
        `yoki ${formatWait(failure.retryAfterSeconds)} keyin urinib ko'ring.`
      );
    case 'CAPTCHA_QUOTA_EXCEEDED':
      return `⏳ Juda ko'p urinish. ${formatWait(failure.retryAfterSeconds)} keyin qayta urinib ko'ring.`;
    case 'OTP_ATTEMPTS_EXHAUSTED':
      return '❌ SMS kodni kiritish urinishlari tugadi. Boshidan boshlash uchun /vote';
    case 'INVALID_OTP_FORMAT':
      return "❌ Kod faqat raqamlardan iborat bo'lishi kerak (4-8 xona). Qaytadan kiriting:";
    case 'INVALID_OTP':
      return "❌ Kod noto'g'ri yoki muddati o'tgan. Qaytadan kiriting:";
    case 'CAPTCHA_REJECTED':
      return "❌ Captcha noto'g'ri yechildi. Boshidan boshlash uchun /vote";
    case 'SESSION_EXPIRED':
      return '⌛️ Sessiya muddati tugadi. Boshidan boshlash uchun /vote';
    case 'SERVICE_UNAVAILABLE':
      return "🌐 openbudget.uz hozir javob bermayapti. Bir necha daqiqadan so'ng urinib ko'ring.";
    case 'SERVICE_DEGRADED':
      return "⚙️ Xizmat vaqtincha mavjud emas. Bir necha daqiqadan so'ng urinib ko'ring.";
    case 'API_ERROR':
      return "❌ Ovoz berishda xatolik yuz berdi. Keyinroq urinib ko'ring.";
    case 'UNKNOWN':
      return "❌ Kutilmagan xatolik yuz berdi. Qaytadan urinib ko'ring: /vote";
  }
}

/** Soniyani "2 soatdan" / "15 daqiqadan" ko'rinishida yozadi. */
export function formatWait(seconds = 0): string {
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) {
    return `${hours} soatdan`;
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} daqiqadan`;
}

/** Ovoz holatini foydalanuvchi uchun belgi bilan yozadi. */
export function formatVoteStatus(status: VoteStatus): string {
  switch (status) {
    case VoteStatus.SUCCESS:
      return '✅ qabul qilindi';
    case VoteStatus.FAILED:
      return '❌ muvaffaqiyatsiz';
    case VoteStatus.VERIFIED:
      return '🔄 tasdiqlanmoqda';
    case VoteStatus.CODE_SENT:
      return '📩 SMS yuborilgan';
    case VoteStatus.CAPTCHA_SENT:
      return '🧩 captcha bosqichida';
    case VoteStatus.PENDING:
      return '⏳ boshlangan';
  }
}
