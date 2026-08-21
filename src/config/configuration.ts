/**
 * Ilova konfiguratsiyasi — barcha environment variable'lar shu yerdan o'qiladi.
 * Kodning boshqa joyida `process.env` ga to'g'ridan-to'g'ri murojaat qilinmasin.
 */

export interface AppConfig {
  /** HTTP server porti (captcha WebApp static fayllari uchun) */
  port: number;
  /** `production` bo'lsa qo'shimcha debug loglar o'chiriladi */
  nodeEnv: string;
  /** Statistika "bugun/kecha" chegaralarini hisoblash uchun IANA vaqt mintaqasi */
  timeZone: string;
}

/** Bot Telegram'dan update'larni qanday oladi. */
export type BotMode = 'polling' | 'webhook';

export interface BotConfig {
  /** @BotFather dan olingan token */
  token: string;
  /** `polling` — development, `webhook` — production */
  mode: BotMode;
  /** Webhook rejimida Telegram so'rov yuboradigan to'liq manzil */
  webhookUrl?: string;
  /**
   * `X-Telegram-Bot-Api-Secret-Token` sarlavhasida keladigan maxfiy qiymat.
   * Bot tokenini URL ga qo'yishdan ko'ra shu afzal: URL proxy va nginx
   * loglariga tushadi, sarlavha esa tushmaydi.
   */
  webhookSecret?: string;
  /** Admin buyruqlariga ruxsati bor Telegram user ID'lar */
  adminIds: number[];
  /** Captcha Mini App ochiladigan HTTPS manzil */
  webappUrl: string;
}

export interface OpenBudgetConfig {
  baseUrl: string;
  /**
   * Rasmiy Telegram boti (`@ochiqbudjetbot`).
   * Unga `?start=<publicId>` bilan o'tilsa captcha ham, SMS ham talab
   * qilinmaydi — Telegram shaxsni o'zi tasdiqlaydi.
   */
  officialBot: string;
  /** Tashabbusning ommaviy raqami — rasmiy botga deep-link parametri. */
  initiativePublicId: string;
  districtId: number;
  initiativeUuid: string;
  initiativeUrl: string;
  /**
   * Endpoint yo'llari DevTools bilan tasdiqlanganmi.
   * Production'da `false` bo'lsa ilova ishga tushmaydi — tasdiqlanmagan
   * yo'llar bilan real foydalanuvchilarga SMS yuborilib ketmasin.
   */
  endpointsVerified: boolean;
}

export interface RedisConfig {
  url: string;
}

export interface DatabaseConfig {
  url: string;
}

export interface Configuration {
  app: AppConfig;
  bot: BotConfig;
  openbudget: OpenBudgetConfig;
  redis: RedisConfig;
  database: DatabaseConfig;
}

/** Majburiy env variable'ni o'qiydi, yo'q bo'lsa ilovani ishga tushirmaydi. */
function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `Environment variable "${key}" majburiy, lekin o'rnatilmagan (.env faylni tekshiring)`,
    );
  }
  return value;
}

/** Ixtiyoriy env variable'ni default qiymat bilan o'qiydi. */
function optionalEnv(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

/**
 * Majburiy raqamli env'ni o'qiydi.
 * `parseInt` NaN qaytarsa ilova ishga tushmaydi — aks holda NaN jimgina
 * so'rov URL'iga tushib ketadi va sababini topish qiyin bo'ladi.
 */
function requireNumberEnv(key: string): number {
  const value = Number.parseInt(requireEnv(key), 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Environment variable "${key}" butun son bo'lishi kerak`);
  }
  return value;
}

/** Ixtiyoriy raqamli env — noto'g'ri qiymat berilsa ham xatolik beradi. */
function optionalNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Environment variable "${key}" butun son bo'lishi kerak`);
  }
  return value;
}

/**
 * IANA vaqt mintaqasi nomini tekshiradi.
 * Noto'g'ri bo'lsa (masalan "Asia/Toshkent") ilova ishga tushmaydi — aks holda
 * xato faqat admin `/stats` bosganda RangeError bo'lib chiqadi.
 */
function requireTimeZone(key: string, fallback: string): string {
  const value = optionalEnv(key, fallback);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new Error(
      `Environment variable "${key}" haqiqiy IANA vaqt mintaqasi bo'lishi kerak (masalan: Asia/Tashkent)`,
    );
  }
  return value;
}

/** URL ni tekshiradi va HTTPS ekanini majburlaydi. */
function requireHttpsUrl(key: string, fallback?: string): string {
  const value = fallback === undefined ? requireEnv(key) : optionalEnv(key, fallback);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Environment variable "${key}" haqiqiy URL bo'lishi kerak`);
  }
  // Telefon, OTP va gr_token shu kanal orqali ketadi — ochiq HTTP mumkin emas.
  if (parsed.protocol !== 'https:') {
    throw new Error(`Environment variable "${key}" https:// bilan boshlanishi kerak`);
  }
  return value;
}

/** Bot rejimini o'qiydi va tekshiradi. */
function requireBotMode(): BotMode {
  const value = optionalEnv('BOT_MODE', 'polling');
  if (value !== 'polling' && value !== 'webhook') {
    throw new Error(
      'Environment variable "BOT_MODE" faqat "polling" yoki "webhook" bo\'lishi mumkin',
    );
  }
  return value;
}

/**
 * Webhook maxfiy kalitini o'qiydi.
 * Telegram 1-256 belgi va faqat `A-Z a-z 0-9 _ -` ga ruxsat beradi.
 */
function requireWebhookSecret(): string {
  const value = requireEnv('WEBHOOK_SECRET');
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(value)) {
    throw new Error(
      'Environment variable "WEBHOOK_SECRET" kamida 16 belgi va faqat A-Z a-z 0-9 _ - dan iborat bo\'lishi kerak',
    );
  }
  return value;
}

/** `true`/`1` qiymatlarini boolean'ga aylantiradi. */
function parseBoolean(raw: string): boolean {
  return raw === 'true' || raw === '1';
}

/** `123,456` ko'rinishidagi ro'yxatni raqamlar massiviga aylantiradi. */
function parseIdList(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export default (): Configuration => {
  const nodeEnv = optionalEnv('NODE_ENV', 'development');
  const botMode = requireBotMode();
  const endpointsVerified = parseBoolean(optionalEnv('OPENBUDGET_ENDPOINTS_VERIFIED', 'false'));

  // Tasdiqlanmagan endpointlar bilan production'ga chiqish — real
  // foydalanuvchilarga noto'g'ri so'rov (va SMS) yuborish demak.
  // Tekshiruv shu yerda: provayderlar (Redis/Prisma ulanishlari) yaratilgunicha.
  if (nodeEnv === 'production' && !endpointsVerified) {
    throw new Error(
      'openbudget.uz endpointlari tasdiqlanmagan. src/openbudget/openbudget.endpoints.ts ' +
        "ni DevTools bilan tekshirib, .env ga OPENBUDGET_ENDPOINTS_VERIFIED=true qo'ying.",
    );
  }

  return {
    app: {
      port: optionalNumberEnv('PORT', 3000),
      nodeEnv,
      timeZone: requireTimeZone('APP_TIMEZONE', 'Asia/Tashkent'),
    },
    bot: {
      token: requireEnv('BOT_TOKEN'),
      mode: botMode,
      ...(botMode === 'webhook'
        ? { webhookUrl: requireHttpsUrl('WEBHOOK_URL'), webhookSecret: requireWebhookSecret() }
        : {}),
      adminIds: parseIdList(optionalEnv('ADMIN_IDS', '')),
      webappUrl: requireHttpsUrl('WEBAPP_URL'),
    },
    openbudget: {
      baseUrl: requireHttpsUrl('OPENBUDGET_BASE_URL', 'https://new.openbudget.uz'),
      districtId: requireNumberEnv('DISTRICT_ID'),
      initiativeUuid: requireEnv('INITIATIVE_UUID'),
      officialBot: optionalEnv('OPENBUDGET_BOT', 'ochiqbudjetbot'),
      initiativePublicId: requireEnv('INITIATIVE_PUBLIC_ID'),
      initiativeUrl: requireEnv('INITIATIVE_URL'),
      endpointsVerified,
    },
    redis: {
      url: requireEnv('REDIS_URL'),
    },
    database: {
      url: requireEnv('DATABASE_URL'),
    },
  };
};
