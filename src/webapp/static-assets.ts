import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Captcha Mini App shu yo'l ostida beriladi. */
export const WEBAPP_PREFIX = '/webapp/';

/**
 * Mini App statik fayllarini ulaydi.
 *
 * MUHIM: faqat `webapp/public` beriladi. `dist/webapp` ning o'zini berish
 * kompilyatsiya natijalarini (`.js`, `.js.map`, `.d.ts`) ham ochib qo'yardi —
 * ya'ni initData imzo mantiqi manbasi tashqariga chiqib ketardi.
 *
 * `main.ts` va e2e test ayni shu funksiyani chaqiradi, shuning uchun test
 * haqiqiy konfiguratsiyani tekshiradi.
 */
export function configureWebappAssets(app: NestExpressApplication, rootDir: string): void {
  app.useStaticAssets(join(rootDir, 'webapp', 'public'), {
    prefix: WEBAPP_PREFIX,
    setHeaders: (res: ServerResponse) => {
      // Sahifa inline skript ishlatadi va Telegram SDK'sini yuklaydi.
      // `connect-src 'self'` — sahifa ma'lumotni tashqariga yubora olmaydi.
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'none'",
          // `unsafe-inline` YO'Q: sahifa mantiqi captcha.js ga chiqarilgan,
          // shuning uchun bu direktiva haqiqatan XSS'ni to'sadi.
          "script-src 'self' https://telegram.org",
          // Inline style qoladi: marker joylashuvi `element.style` orqali
          // qo'yiladi va bu XSS sink emas.
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "connect-src 'self'",
          "base-uri 'none'",
          "form-action 'none'",
          'frame-ancestors https://web.telegram.org https://webk.telegram.org ' +
            'https://webz.telegram.org https://telegram.org',
        ].join('; '),
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
    },
  });
}
