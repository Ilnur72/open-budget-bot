import { Controller, Get, Header, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { toErrorInfo } from '../common/utils/error.util';

/** Bog'liqliklarni tekshirish uchun timeout — health check osilib qolmasin. */
const DEPENDENCY_TIMEOUT_MS = 2_000;

interface LivenessResponse {
  status: 'ok';
  uptime: number;
}

interface ReadinessResponse {
  status: 'ok' | 'degraded';
  checks: { database: boolean; redis: boolean };
}

/**
 * Health endpointlari.
 *
 * `/health` — liveness: process tirikmi. Docker healthcheck shuni chaqiradi,
 * shuning uchun u hech qanday tashqi bog'liqlikka murojaat qilmaydi: DB
 * vaqtincha tushganda konteynerni qayta ishga tushirish muammoni hal qilmaydi,
 * faqat kutish oynasini uzaytiradi.
 *
 * `/health/ready` — readiness: DB va Redis javob beryaptimi (load balancer va
 * deploy skriptlari uchun).
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  liveness(): LivenessResponse {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async readiness(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    if (!database || !redis) {
      // 503 SHART: load balancer va deploy skriptlari status KODIGA qaraydi,
      // 200 qaytarsak buzuq ilova "sog'lom" deb qabul qilinardi.
      throw new HttpException(
        { status: 'degraded', checks: { database, redis } } satisfies ReadinessResponse,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok', checks: { database, redis } };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, DEPENDENCY_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.logger.warn(`Health: PostgreSQL javob bermadi — ${toErrorInfo(error).message}`);
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await withTimeout(this.redis.client.ping(), DEPENDENCY_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.logger.warn(`Health: Redis javob bermadi — ${toErrorInfo(error).message}`);
      return false;
    }
  }
}

/** Promise berilgan vaqtda tugamasa xatolik beradi. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
