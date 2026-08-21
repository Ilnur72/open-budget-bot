import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Health endpointlari — PrismaModule va RedisModule global. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
