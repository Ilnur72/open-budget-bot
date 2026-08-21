import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `initData` shundan eski bo'lsa qabul qilinmaydi.
 *
 * Imzo o'z-o'zidan muddatsiz — `auth_date` siz o'g'irlangan initData abadiy
 * ishlar edi. Telegram uni sahifa URL fragmentiga qo'yadi, ya'ni u brauzer
 * tarixida qolishi mumkin. Ekotizim standarti 24 soat, lekin captcha
 * sessiyasining o'zi 15 daqiqa yashaydi — 1 soat yetarlidan ham ortiq.
 */
const MAX_AGE_SECONDS = 60 * 60;

/**
 * Server soati Telegram'nikidan biroz orqada bo'lishi mumkin.
 * Bunga bardosh bermasak, barcha foydalanuvchilar 401 olardi.
 */
const MAX_CLOCK_SKEW_SECONDS = 60;

/** Telegram WebApp'dan kelgan foydalanuvchi ma'lumoti. */
export interface InitDataUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
}

/**
 * `Telegram.WebApp.initData` ni tekshiradi.
 *
 * Algoritm (Telegram hujjati):
 *   secret = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash   = HMAC_SHA256(key = secret, data = data_check_string)
 * bu yerda `data_check_string` — `hash` dan boshqa barcha maydonlar
 * `key=value` ko'rinishida, kalit bo'yicha saralanib `\n` bilan birlashtiriladi.
 *
 * @returns tasdiqlangan foydalanuvchi yoki `null`
 */
export function verifyInitData(initData: string, botToken: string): InitDataUser | null {
  if (initData.length === 0) {
    return null;
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get('hash');
  if (hash === null || !/^[0-9a-f]{64}$/i.test(hash)) {
    return null;
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();

  // `timingSafeEqual` uzunliklar teng bo'lishini talab qiladi — hash regex bilan
  // allaqachon 32 baytga tenglashtirilgan.
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }

  if (!isFresh(params.get('auth_date'))) {
    return null;
  }

  return parseUser(params.get('user'));
}

/** `auth_date` juda eski emasligini tekshiradi. */
function isFresh(authDate: string | null): boolean {
  if (authDate === null) {
    return false;
  }
  const seconds = Number.parseInt(authDate, 10);
  if (!Number.isSafeInteger(seconds)) {
    return false;
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - seconds;
  return ageSeconds >= -MAX_CLOCK_SKEW_SECONDS && ageSeconds <= MAX_AGE_SECONDS;
}

/** `user` maydonidagi JSON'ni tekshirib o'qiydi. */
function parseUser(raw: string | null): InitDataUser | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const {
    id,
    first_name: firstName,
    last_name: lastName,
    username,
  } = parsed as Record<string, unknown>;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  return {
    id,
    ...(typeof firstName === 'string' ? { firstName } : {}),
    ...(typeof lastName === 'string' ? { lastName } : {}),
    ...(typeof username === 'string' ? { username } : {}),
  };
}
