import { Logger, type LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { toErrorInfo } from './common/utils/error.util';
import { JsonLogger, createDevelopmentLogger } from './common/logger/json.logger';
import { configureWebappAssets } from './webapp/static-assets';

/** Production'da batafsil loglar o'chiriladi. */
const PRODUCTION_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log'];
const DEVELOPMENT_LOG_LEVELS: LogLevel[] = [...PRODUCTION_LOG_LEVELS, 'debug', 'verbose'];

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // bufferLogs — ConfigService o'qilgunicha loglar ushlab turiladi.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // create() provayderlarni yaratadi (RedisService darhol ulanadi), shuning uchun
  // bundan keyingi HAR QANDAY xatolikda app.close() chaqirilishi shart —
  // aks holda ochiq handle qoladi va process umuman chiqmaydi.
  try {
    const configService = app.get(ConfigService);
    const isProduction = configService.getOrThrow<string>('app.nodeEnv') === 'production';
    // Production'da bir qatorli JSON — Docker/loki uni parse qila oladi.
    app.useLogger(
      isProduction
        ? new JsonLogger(PRODUCTION_LOG_LEVELS)
        : createDevelopmentLogger(DEVELOPMENT_LOG_LEVELS),
    );
    // bufferLogs bilan loglar odatda listen() da chiqariladi — listen() yiqilsa
    // sabab ko'rinmay qoladi, shuning uchun buferni shu yerda bo'shatamiz.
    app.flushLogs();

    // Stack fingerprinting'ni kamaytirish.
    app.getHttpAdapter().getInstance().disable('x-powered-by');

    // Barcha javoblarga (jumladan API) — statik fayllarga alohida qo'yiladi.
    app.use((_req: unknown, res: ServerResponse, next: () => void) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    });

    // SIGTERM/SIGINT kelganda bot, Redis va DB ulanishlari toza yopilishi uchun.
    app.enableShutdownHooks();

    // Captcha WebApp uchun static fayllar: /webapp/captcha.html
    configureWebappAssets(app, __dirname);

    await app.listen(configService.getOrThrow<number>('app.port'));
    logger.log(`HTTP server ${configService.getOrThrow<number>('app.port')}-portda ishlamoqda`);
  } catch (error) {
    app.flushLogs();
    // `process.exit()` ishlatilmaydi: u stdout'ni kesib, xatolik sababini yo'q qiladi.
    const { message, stack } = toErrorInfo(error);
    logger.error(`Ilova ishga tushmadi: ${message}`, stack);
    await app.close().catch(() => undefined);
    process.exitCode = 1;
  }
}

void bootstrap().catch((error: unknown) => {
  const { message, stack } = toErrorInfo(error);
  new Logger('Bootstrap').error(`Ilova ishga tushmadi: ${message}`, stack);
  process.exitCode = 1;
});
