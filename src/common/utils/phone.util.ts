/** O'zbekiston telefon raqamining xalqaro prefiksi. */
const UZ_PHONE_PREFIX = '+998';

/** Normalizatsiyadan keyin yagona qabul qilinadigan format. */
const UZ_PHONE_PATTERN = /^\+998\d{9}$/;

/**
 * Telefon raqamni `+998XXXXXXXXX` ko'rinishiga keltiradi.
 *
 * Bu normalizatsiya majburiy: Telegram kontakti raqamni `+` siz beradi
 * (`998901234567`), qo'lda kiritilgan raqam esa `+998...` bo'ladi. Ikkalasi
 * DB'ga turlicha yozilsa, dublikat ovozni to'sadigan unikal indeks chetlab
 * o'tiladi va bitta raqam bir necha marta ovoz bera oladi.
 */
export function formatUzPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const national = digits.startsWith('998') ? digits.slice(3) : digits;
  return `${UZ_PHONE_PREFIX}${national}`;
}

/** Raqam normalizatsiyadan keyin O'zbekiston mobil raqami formatiga mos keladimi. */
export function isValidUzPhone(raw: string): boolean {
  return UZ_PHONE_PATTERN.test(formatUzPhone(raw));
}
