import { Logger, type LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { toErrorInfo } from './common/utils/error.util';
import { JsonLogger, createDevelopmentLogger } from './common/logger/json.logger';

const PRODUCTION_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log'];
const DEVELOPMENT_LOG_LEVELS: LogLevel[] = [...PRODUCTION_LOG_LEVELS, 'debug', 'verbose'];

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  try {
    const configService = app.get(ConfigService);
    const isProduction = configService.getOrThrow<string>('app.nodeEnv') === 'production';
    app.useLogger(
      isProduction
        ? new JsonLogger(PRODUCTION_LOG_LEVELS)
        : createDevelopmentLogger(DEVELOPMENT_LOG_LEVELS),
    );
    app.flushLogs();

    app.getHttpAdapter().getInstance().disable('x-powered-by');

    app.use((_req: unknown, res: ServerResponse, next: () => void) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    });

    app.enableShutdownHooks();

    await app.listen(configService.getOrThrow<number>('app.port'));
    logger.log(`HTTP server ${configService.getOrThrow<number>('app.port')}-portda ishlamoqda`);
  } catch (error) {
    app.flushLogs();
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
