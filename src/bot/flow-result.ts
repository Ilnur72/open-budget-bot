/**
 * Oqim xatoliklarining kodlari.
 *
 * Nima uchun xatolik obyekti emas: `conversation.external()` qaytargan
 * qiymatni `structuredClone` qiladi, u esa `Error` merosxo'rlarini yo'q qiladi
 * (prototip yo'qoladi, `name` "Error" ga aylanadi, custom maydonlar o'chadi).
 * Shuning uchun conversation chegarasidan faqat oddiy obyektlar o'tadi.
 */
export type FlowErrorCode =
  | 'INVALID_PHONE'
  | 'DUPLICATE_VOTE'
  | 'PHONE_RATE_LIMITED'
  | 'USER_QUOTA_EXCEEDED'
  | 'MANUAL_QUOTA_EXCEEDED'
  | 'CAPTCHA_QUOTA_EXCEEDED'
  | 'OTP_ATTEMPTS_EXHAUSTED'
  | 'INVALID_OTP_FORMAT'
  | 'INVALID_OTP'
  | 'CAPTCHA_REJECTED'
  | 'SESSION_EXPIRED'
  | 'SERVICE_UNAVAILABLE'
  | 'SERVICE_DEGRADED'
  | 'API_ERROR'
  | 'UNKNOWN';

export interface FlowFailure {
  code: FlowErrorCode;
  /** Limitga tushganda qancha kutish kerakligi. */
  retryAfterSeconds?: number;
}

export type FlowResult<T> = { ok: true; value: T } | { ok: false; failure: FlowFailure };

export const ok = <T>(value: T): FlowResult<T> => ({ ok: true, value });
export const fail = <T>(code: FlowErrorCode, retryAfterSeconds?: number): FlowResult<T> => ({
  ok: false,
  failure: retryAfterSeconds === undefined ? { code } : { code, retryAfterSeconds },
});

/** Foydalanuvchi qayta urinib ko'rishi mumkin bo'lgan xatoliklar. */
export function isRetryableOtpFailure(failure: FlowFailure): boolean {
  return failure.code === 'INVALID_OTP' || failure.code === 'INVALID_OTP_FORMAT';
}
