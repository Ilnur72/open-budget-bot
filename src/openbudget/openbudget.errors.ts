/**
 * openbudget.uz bilan ishlashda yuzaga keladigan xatoliklar.
 *
 * Alohida tiplar kerak, chunki bot oqimi ularga turlicha javob beradi:
 * noto'g'ri OTP — qayta so'rash, tarmoq uzilishi — keyinroq urinish,
 * limit — butunlay to'xtatish.
 */

/** Umumiy API xatoligi — javob keldi, lekin muvaffaqiyatsiz. */
export class OpenBudgetApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'OpenBudgetApiError';
  }
}

/** Serverga umuman yetib borilmadi (tarmoq, DNS, timeout). */
export class OpenBudgetUnavailableError extends Error {
  constructor(readonly cause: string) {
    super('openbudget.uz hozir javob bermayapti');
    this.name = 'OpenBudgetUnavailableError';
  }
}

/** Captcha yechimi qabul qilinmadi. */
export class CaptchaRejectedError extends Error {
  constructor(readonly detail?: string) {
    super("Captcha noto'g'ri yechildi");
    this.name = 'CaptchaRejectedError';
  }
}

/** SMS kod noto'g'ri yoki muddati o'tgan. */
export class InvalidOtpError extends Error {
  constructor(readonly detail?: string) {
    super("SMS kod noto'g'ri yoki muddati o'tgan");
    this.name = 'InvalidOtpError';
  }
}

/** Bu raqam kunlik ovoz limitini ishlatib bo'lgan. */
export class PhoneRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Bu raqamdan bugun allaqachon ovoz berilgan');
    this.name = 'PhoneRateLimitedError';
  }
}

/** Kunlik limitni ishonchli tekshirib bo'lmadi (Redis muammosi) — ruxsat berilmaydi. */
export class RateLimiterUnavailableError extends Error {
  constructor(readonly reason: string) {
    super("Limitni tekshirib bo'lmadi, keyinroq urinib ko'ring");
    this.name = 'RateLimiterUnavailableError';
  }
}

/** Bitta Telegram foydalanuvchisi kunlik raqamlar kvotasini ishlatib bo'ldi. */
export class UserQuotaExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Bugungi urinishlar soni tugadi');
    this.name = 'UserQuotaExceededError';
  }
}

/**
 * Qo'lda kiritilgan raqamlar uchun kunlik limit tugadi.
 * Kontakt tugmasi orqali yuborishda limit kengroq — u yerda raqam egaligini
 * Telegram tasdiqlaydi.
 */
export class ManualPhoneQuotaExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Qo'lda kiritish limiti tugadi");
    this.name = 'ManualPhoneQuotaExceededError';
  }
}

/** Captcha so'rovlari soatlik limiti tugadi. */
export class CaptchaQuotaExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Juda ko'p captcha so'rovi");
    this.name = 'CaptchaQuotaExceededError';
  }
}

/** SMS kodni kiritish urinishlari tugadi — sessiya bekor qilinadi. */
export class OtpAttemptsExhaustedError extends Error {
  constructor() {
    super('SMS kodni kiritish urinishlari tugadi');
    this.name = 'OtpAttemptsExhaustedError';
  }
}

/** Captcha yechimi (nuqtalar) kutilgan formatda emas. */
export class InvalidCaptchaPointsError extends Error {
  constructor(readonly reason: string) {
    super("Captcha yechimi noto'g'ri formatda");
    this.name = 'InvalidCaptchaPointsError';
  }
}

/** SMS kod formati noto'g'ri (raqamlardan iborat bo'lishi kerak). */
export class InvalidOtpFormatError extends Error {
  constructor() {
    super("SMS kod faqat raqamlardan iborat bo'lishi kerak");
    this.name = 'InvalidOtpFormatError';
  }
}

/** Captcha/SMS sessiyasi muddati o'tgan yoki topilmadi. */
export class VoteSessionExpiredError extends Error {
  constructor() {
    super("Ovoz berish sessiyasi muddati o'tdi");
    this.name = 'VoteSessionExpiredError';
  }
}

/**
 * So'rov serverga umuman yetib bormaganini bildiruvchi kodlar.
 * Faqat shu holatda SMS hisoblagichini qaytarish xavfsiz.
 */
const PRE_SEND_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** Xatolik "so'rov yuborilmagan" turidanmi — SMS limitini qaytarish uchun. */
export function isPreSendFailure(error: unknown): boolean {
  return error instanceof OpenBudgetUnavailableError && PRE_SEND_CODES.has(error.cause);
}
