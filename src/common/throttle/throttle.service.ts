import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Redis'ga tayangan oddiy sanovchi chegaralagich.
 *
 * `VoteRateLimiter` dan farqli o'laroq bu yerda fail-OPEN: Redis nosozligida
 * xizmatni butunlay to'xtatib qo'ymaslik kerak. Bu xavfsizlik chegarasi emas,
 * suiiste'molni sekinlashtirish vositasi — ovoz limitlari alohida va fail-closed.
 */
@Injectable()
export class ThrottleService {
  private readonly logger = new Logger(ThrottleService.name);

  constructor(private readonly redisService: RedisService) {}

  /** Kalit oynadagi chegaradan oshdimi. */
  async isExceeded(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    try {
      const results = await this.redisService.client
        .multi()
        .incr(key)
        .expire(key, windowSeconds, 'NX')
        .exec();

      const value = results?.[0]?.[1];
      const used = typeof value === 'number' ? value : 0;

      if (used === limit + 1) {
        // Faqat bir marta log qilamiz — flood log'ni ham to'ldirmasin.
        this.logger.warn(`Chegara oshdi: ${key}`);
      }

      return used > limit;
    } catch {
      return false;
    }
  }
}
