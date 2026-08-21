import { ConsoleLogger, type LogLevel, type LoggerService } from '@nestjs/common';
import { safeSerialize } from './safe-serialize';

/** JSON log yozuvi. */
interface LogRecord {
  time: string;
  level: LogLevel;
  context?: string;
  message: string;
  stack?: string;
}

/**
 * Production uchun bir qatorli JSON logger.
 *
 * Nima uchun faylga yozmaymiz (spetsifikatsiyada "fayl + console" deyilgan):
 * konteyner ichida faylga yozish anti-pattern — fayl konteyner o'lganda
 * yo'qoladi, disk to'lganda esa ilova yiqiladi. Docker'ning `json-file`
 * drayveri stdout'ni o'zi yig'adi va `max-size`/`max-file` bilan rotatsiya
 * qiladi (docker-compose'da sozlangan).
 *
 * Nima uchun Winston/Pino emas: bitta vazifa uchun yangi bog'liqlik
 * qo'shishning ma'nosi yo'q — Nest'ning `LoggerService` interfeysi yetarli.
 */
export class JsonLogger implements LoggerService {
  constructor(private readonly levels: LogLevel[]) {}

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, stack?: string): void {
    if (!this.levels.includes(level)) {
      return;
    }

    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      ...(context === undefined ? {} : { context }),
      ...describe(message),
      ...(stack === undefined ? {} : { stack }),
    };

    const line = JSON.stringify(record);
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}

/**
 * Xabarni matn va (bo'lsa) stack'ga ajratadi.
 * Obyekt kelsa u redaksiyalanadi — Nest exception filtri xom xatolik
 * obyektini uzatadi va u yerda maxfiy qiymatlar bo'lishi mumkin.
 */
function describe(message: unknown): { message: string; stack?: string } {
  if (typeof message === 'string') {
    return { message };
  }
  if (message instanceof Error) {
    return {
      message: `${message.name}: ${message.message}`,
      ...(message.stack === undefined ? {} : { stack: message.stack }),
    };
  }
  return { message: safeSerialize(message) };
}

/** Development uchun o'qish oson bo'lgan rangli logger. */
export function createDevelopmentLogger(levels: LogLevel[]): LoggerService {
  return new ConsoleLogger({ logLevels: levels });
}
