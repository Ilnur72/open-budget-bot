/**
 * openbudget.uz HTML javoblarini o'qish.
 *
 * Sayt JSON emas, server tomonda render qilingan HTML qaytaradi. To'liq HTML
 * parser (cheerio) qo'shmaymiz: bizga faqat bir nechta aniq qiymat kerak va
 * ular barqaror joylarda turadi. Regex bu yerda yetarli va bog'liqliksiz.
 */

/** Captcha sahifasidan ajratib olingan ma'lumot. */
export interface ParsedCaptchaPage {
  imageA: string;
  imageB: string;
}

/** Formadan keyingi javob qanday sahifa ekani. */
export type ResponsePage =
  | { kind: 'captcha'; error?: string }
  | { kind: 'otp'; error?: string }
  | { kind: 'success' }
  | { kind: 'unknown'; error?: string };

/** Barcha `<img>` teglarini `src` bilan birga qaytaradi. */
function findImages(html: string): { tag: string; src: string }[] {
  const result: { tag: string; src: string }[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src !== undefined) {
      result.push({ tag, src });
    }
  }
  return result;
}

/**
 * Captcha sahifasidan ikkala rasmni ajratadi.
 *
 * Rasm B `id="imageB"` bilan belgilangan; rasm A esa `id` siz, shuning uchun
 * u "qolgan data: rasm" sifatida topiladi. Bu HTML tuzilmasi o'zgarsa ham
 * ishlaydi — ichma-ich `<div>` larga bog'lanmaydi.
 */
export function parseCaptchaPage(html: string): ParsedCaptchaPage | null {
  const images = findImages(html).filter((image) => image.src.startsWith('data:image/'));

  const imageB = images.find((image) => /\bid=["']imageB["']/i.test(image.tag))?.src;
  const imageA = images.find((image) => !/\bid=["']imageB["']/i.test(image.tag))?.src;

  if (imageA === undefined || imageB === undefined) {
    return null;
  }
  return { imageA, imageB };
}

/** `#error-alert` ichidagi matnni oladi (bo'sh bo'lsa `undefined`). */
export function extractError(html: string): string | undefined {
  const block = /<div[^>]*\bid=["']error-alert["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const raw = block?.[1];
  if (raw === undefined) {
    return undefined;
  }
  const text = raw
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Javob qaysi bosqich sahifasi ekanini aniqlaydi.
 * Forma `action` i eng ishonchli belgi — sarlavha va matnlar tarjimaga bog'liq.
 */
export function classifyResponse(html: string): ResponsePage {
  const action = /<form[^>]*\baction=["']([^"']+)["']/i.exec(html)?.[1] ?? '';
  const error = extractError(html);

  if (action.endsWith('/verify')) {
    return error === undefined ? { kind: 'otp' } : { kind: 'otp', error };
  }
  if (action.endsWith('/captcha')) {
    return error === undefined ? { kind: 'captcha' } : { kind: 'captcha', error };
  }
  // Forma yo'q va xato ham yo'q — oqim yakunlangan bo'lishi mumkin.
  if (action === '' && error === undefined) {
    return { kind: 'success' };
  }
  return error === undefined ? { kind: 'unknown' } : { kind: 'unknown', error };
}
