/** openbudget.uz API bilan almashinadigan ma'lumot tiplari. */

/**
 * Captcha sahifasidan olingan ma'lumot.
 *
 * `captchaKey` yo'q — sayt sessiyani cookie orqali yuritadi, formada hech
 * qanday yashirin kalit uzatilmaydi.
 */
export interface CaptchaChallenge {
  /** `data:image/png;base64,...` ko'rinishidagi A rasm */
  imageA: string;
  /** `data:image/jpeg;base64,...` ko'rinishidagi B rasm */
  imageB: string;
  /** Javobdagi `Set-Cookie` (bo'lsa) — keyingi so'rovlarda qaytariladi */
  cookie?: string;
}

/** Foydalanuvchi captcha rasmida bosgan nuqta. */
export interface CaptchaPoint {
  x: number;
  y: number;
}

/** Telefon + captcha yuborilgandan keyingi natija. SMS shu paytda ketadi. */
export interface SendCodeResult {
  /** Keyingi so'rov uchun cookie (sessiya davom etishi kerak) */
  cookie?: string;
}

/** OTP tasdiqlash natijasi. */
export interface VerifyOtpResult {
  message: string;
}

/**
 * Ovoz oqimining Redis'da saqlanadigan holati.
 * Bosqichma-bosqich to'ladi: avval captcha kaliti, SMS yuborilgach telefon va token.
 */
export interface VoteSession {
  /**
   * Sayt sessiyasi cookie'si.
   * `captchaKey` o'rniga shu ishlatiladi — sayt formada kalit uzatmaydi.
   */
  cookie?: string;
  /**
   * Captcha rasmlari.
   * Bu yerda saqlanadi, chunki WebApp (05-bosqich) ularni shu sessiyadan olishi
   * SHART: qayta `getCaptcha()` chaqirilsa boshqa kalit keladi va yechim
   * hech qachon to'g'ri kelmaydi.
   */
  imageA: string;
  imageB: string;
  /** Boshlangan ovoz yozuvi — timeout'da uni yopish uchun */
  voteId?: number;
  /** SMS yuborilgandan keyin to'ldiriladi */
  phone?: string;
  /** SMS kod necha marta kiritilgani — brute-force'ni to'sish uchun. */
  otpAttempts: number;
}

/** SMS yuborilgandan keyingi to'liq sessiya — OTP tasdiqlash uchun yetarli. */
export interface ConfirmableVoteSession extends VoteSession {
  phone: string;
}
