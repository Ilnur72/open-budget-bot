import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Global modul — session, captcha va rate limiting hamma joyda kerak bo'ladi. */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
