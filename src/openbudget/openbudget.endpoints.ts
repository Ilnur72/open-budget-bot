/**
 * openbudget.uz ovoz berish endpointlari.
 *
 * DevTools bilan tasdiqlangan (22.08.2026). Bu JSON API EMAS — server tomonda
 * render qilinadigan HTML formalar (MVC), shuning uchun javoblar HTML bo'lib
 * keladi va ular parse qilinadi.
 *
 * Oqim:
 *   1. GET  captcha/{uuid}  -> HTML: rasm A (210x70 PNG) + rasm B (345x230 JPEG)
 *   2. POST captcha         -> phoneNumber + points, javob: OTP formasi, SMS ketadi
 *   3. POST verify          -> otpCode + grToken (bo'sh), javob: natija
 */

/** Ovoz berish yo'llarining umumiy prefiksi. */
const VOTE_PREFIX = '/api/v2/vote/mvc';

export interface OpenBudgetEndpoint {
  baseUrl: string | null;
  path: string;
}

export const OPENBUDGET_ENDPOINTS = {
  /** 1-bosqich: captcha sahifasi. `{uuid}` tashabbus identifikatoriga almashadi. */
  captcha: {
    baseUrl: null,
    path: `${VOTE_PREFIX}/captcha/{uuid}`,
  },

  /** 2-bosqich: telefon + captcha yechimi. SMS shu yerda yuboriladi. */
  submitCaptcha: {
    baseUrl: null,
    path: `${VOTE_PREFIX}/captcha`,
  },

  /** 3-bosqich: SMS kodni tasdiqlash va ovozni yakunlash. */
  verifyOtp: {
    baseUrl: null,
    path: `${VOTE_PREFIX}/verify`,
  },

  /** SMS kodni qayta yuborish (sayt tomonda 2 daqiqa kutish talab qilinadi). */
  resendSms: {
    baseUrl: null,
    path: `${VOTE_PREFIX}/resend-sms`,
  },
} as const satisfies Record<string, OpenBudgetEndpoint>;

/** Captcha aynan shuncha nuqta talab qiladi (sahifadagi `const c = 2`). */
export const REQUIRED_CAPTCHA_POINTS = 2;

/**
 * Captcha shuncha millisekunddan keyin eskiradi (sahifadagi `let t = 30000`).
 * Shu sababli telefon raqam captchadan OLDIN so'raladi — aks holda 30 soniyaga
 * sig'ish imkonsiz bo'lardi.
 */
export const CAPTCHA_LIFETIME_MS = 30_000;

/** Rasm B ning haqiqiy o'lchami — koordinatalar shu fazoda kutiladi. */
export const CAPTCHA_IMAGE_WIDTH = 345;
export const CAPTCHA_IMAGE_HEIGHT = 230;
