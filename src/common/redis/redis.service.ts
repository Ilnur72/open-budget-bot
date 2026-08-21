import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { toErrorInfo } from '../utils/error.util';

/**
 * Buyruq necha marta qayta urinilsin. `null` qilinsa buyruq abadiy kutadi va
 * Redis o'chganda handler'lar osilib qoladi — shuning uchun aniq son qo'yilgan.
 */
const MAX_RETRIES_PER_REQUEST = 3;

/** Redis ulanishi — session storage, conversation state va TTL'li kalitlar uchun. */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis(this.configService.getOrThrow<string>('redis.url'), {
      maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
      enableReadyCheck: true,
    });

    this.redis.on('error', (error: Error) => this.logger.error(`Redis xatolik: ${error.message}`));
  }

  /** grammY storage adapteri va boshqa servislar uchun xom ioredis klienti. */
  get client(): Redis {
    return this.redis;
  }

  /** Redis'ga ulanib bo'lmasa ilova "sog'lom" holatda ko'tarilib qolmasligi uchun. */
  async onModuleInit(): Promise<void> {
    await this.redis.ping();
    this.logger.log("Redis ulanishi o'rnatildi");
  }

  async onModuleDestroy(): Promise<void> {
    // quit() reject bo'lsa Nest destroy loop'i to'xtaydi va Prisma yopilmay qoladi.
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(`Redis toza yopilmadi: ${toErrorInfo(error).message}`);
      this.redis.disconnect();
    }
    this.logger.log('Redis ulanishi yopildi');
  }
}
