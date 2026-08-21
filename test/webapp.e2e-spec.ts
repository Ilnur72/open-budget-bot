import { createHmac } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Module } from '@nestjs/common';
import configuration from '../src/config/configuration';
import { RedisModule } from '../src/common/redis/redis.module';
import { ThrottleModule } from '../src/common/throttle/throttle.module';
import { RedisService } from '../src/common/redis/redis.service';
import { VoteSessionStore } from '../src/openbudget/vote-session.store';
import { HealthModule } from '../src/health/health.module';
import { PrismaModule } from '../src/common/prisma/prisma.module';
import { WebappModule } from '../src/webapp/webapp.module';
import { configureWebappAssets } from '../src/webapp/static-assets';

/**
 * Mini App HTTP qatlamini haqiqiy Nest ilovasi ustida tekshiradi.
 *
 * Nima uchun kerak: statik fayl yo'li noto'g'ri sozlansa kompilyatsiya
 * natijalari (`.js`, `.js.map`) tashqariga ochilib ketardi — buni faqat
 * haqiqiy HTTP so'rov ko'rsatadi.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    PrismaModule,
    RedisModule,
    ThrottleModule,
    WebappModule,
    HealthModule,
  ],
})
class WebappTestModule {}

describe('Mini App HTTP qatlami (e2e)', () => {
  const TELEGRAM_ID = 900000000001;

  let app: NestExpressApplication;
  let baseUrl: string;
  let sessionStore: VoteSessionStore;
  let botToken: string;

  /** Haqiqiy Telegram imzosi bilan initData yasaydi. */
  const signInitData = (userId: number): string => {
    const fields = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: userId, first_name: 'E2E' }),
    };
    const dataCheckString = Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    return new URLSearchParams({ ...fields, hash }).toString();
  };

  beforeAll(async () => {
    botToken = process.env.BOT_TOKEN ?? 'e2e-token';
    process.env.BOT_TOKEN = botToken;

    app = await NestFactory.create<NestExpressApplication>(WebappTestModule, { logger: false });
    app.getHttpAdapter().getInstance().disable('x-powered-by');
    app.use((_req: unknown, res: ServerResponse, next: () => void) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    });
    // `main.ts` bilan AYNI konfiguratsiya — test haqiqiy sozlamani tekshiradi.
    configureWebappAssets(app, `${__dirname}/../dist`);
    await app.listen(0);

    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    sessionStore = app.get(VoteSessionStore);
  });

  afterAll(async () => {
    await sessionStore.clear(TELEGRAM_ID);
    await app.close();
    await app
      .get(RedisService)
      .client.quit()
      .catch(() => undefined);

    // Node'ning `fetch` implementatsiyasi (undici) keep-alive socketlarni
    // global pool'da ushlab qoladi va jest chiqmay qoladi.
    const dispatcher = (globalThis as Record<symbol, unknown>)[
      Symbol.for('undici.globalDispatcher.1')
    ] as { close?: () => Promise<void> } | undefined;
    await dispatcher?.close?.();
  });

  describe('statik fayllar', () => {
    it('captcha.html beriladi', async () => {
      const response = await fetch(`${baseUrl}/webapp/captcha.html`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('telegram-web-app.js');
    });

    it("CSP va boshqa xavfsizlik sarlavhalari qo'yiladi", async () => {
      const response = await fetch(`${baseUrl}/webapp/captcha.html`);

      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("default-src 'none'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it.each([
      'init-data.util.js',
      'init-data.util.js.map',
      'captcha.controller.js',
      'webapp.module.js',
    ])('kompilyatsiya natijasi %s OCHIQ BERILMAYDI', async (file) => {
      const response = await fetch(`${baseUrl}/webapp/${file}`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/captcha', () => {
    it('initData siz 401 qaytaradi', async () => {
      const response = await fetch(`${baseUrl}/api/captcha`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' });
    });

    it('buzilgan initData bilan 401 qaytaradi', async () => {
      const response = await fetch(`${baseUrl}/api/captcha`, {
        headers: { 'X-Telegram-Init-Data': `user=%7B%22id%22%3A1%7D&hash=${'0'.repeat(64)}` },
      });

      expect(response.status).toBe(401);
    });

    it("kesh sarlavhalari qo'yiladi — javob boshqa foydalanuvchiga berilmasin", async () => {
      const response = await fetch(`${baseUrl}/api/captcha`, {
        headers: { 'X-Telegram-Init-Data': signInitData(TELEGRAM_ID) },
      });

      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('vary')).toContain('X-Telegram-Init-Data');
    });

    it('x-powered-by oshkor qilinmaydi', async () => {
      const response = await fetch(`${baseUrl}/api/captcha`);

      expect(response.headers.get('x-powered-by')).toBeNull();
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it("sessiya yo'q bo'lsa 404 SESSION_NOT_FOUND", async () => {
      await sessionStore.clear(TELEGRAM_ID);

      const response = await fetch(`${baseUrl}/api/captcha`, {
        headers: { 'X-Telegram-Init-Data': signInitData(TELEGRAM_ID) },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'SESSION_NOT_FOUND' });
    });

    it("sessiya bor bo'lsa rasmlarni beradi, kalitni bermaydi", async () => {
      await sessionStore.startCaptcha(TELEGRAM_ID, {
        imageA: 'AAA',
        imageB: 'BBB',
        cookie: 'JSESSIONID=MAXFIY-KALIT',
      });

      const response = await fetch(`${baseUrl}/api/captcha`, {
        headers: { 'X-Telegram-Init-Data': signInitData(TELEGRAM_ID) },
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({ imageA: 'AAA', imageB: 'BBB' });
      expect(body).not.toContain('MAXFIY-KALIT');
    });

    it('boshqa foydalanuvchi sessiyasiga yeta olmaydi', async () => {
      await sessionStore.startCaptcha(TELEGRAM_ID, {
        imageA: 'AAA',
        imageB: 'BBB',
        cookie: 'JSESSIONID=K',
      });

      // Imzo boshqa ID uchun — sessiya aynan initData dagi foydalanuvchi bo'yicha olinadi.
      const response = await fetch(`${baseUrl}/api/captcha`, {
        headers: { 'X-Telegram-Init-Data': signInitData(TELEGRAM_ID + 1) },
      });

      expect(response.status).toBe(404);
    });
  });
  describe('health endpointlari', () => {
    it('/health tirikligini bildiradi', async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; uptime: number };
      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
    });

    it('/health keshlanmaydi', async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it("/health/ready bog'liqliklarni tekshiradi", async () => {
      const response = await fetch(`${baseUrl}/health/ready`);

      expect(response.status).toBe(200);
      // Lokal PostgreSQL va Redis ishlab turibdi.
      expect(await response.json()).toEqual({
        status: 'ok',
        checks: { database: true, redis: true },
      });
    });
  });
});
