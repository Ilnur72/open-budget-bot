import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { BotModule } from './bot/bot.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ThrottleModule } from './common/throttle/throttle.module';
import configuration from './config/configuration';
import { HealthModule } from './health/health.module';
import { OpenBudgetModule } from './openbudget/openbudget.module';
import { UserModule } from './user/user.module';
import { VoteModule } from './vote/vote.module';
import { WebappModule } from './webapp/webapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
    }),
    PrismaModule,
    RedisModule,
    ThrottleModule,
    OpenBudgetModule,
    UserModule,
    VoteModule,
    AdminModule,
    BotModule,
    WebappModule,
    HealthModule,
  ],
})
export class AppModule {}
