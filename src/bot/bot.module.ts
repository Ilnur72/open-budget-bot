import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { UserModule } from '../user/user.module';
import { BotService } from './bot.service';
import { AdminUpdate } from './admin/admin.update';
import { BroadcastService } from './admin/broadcast.service';
import { PendingBroadcastStore } from './admin/pending-broadcast.store';
import { BotThrottle } from './bot.throttle';
import { BotUpdate } from './bot.update';
import { TelegramWebhookController } from './webhook.controller';

@Module({
  imports: [UserModule, AdminModule],
  controllers: [TelegramWebhookController],
  providers: [
    BotService,
    BotUpdate,
    BotThrottle,
    AdminUpdate,
    BroadcastService,
    PendingBroadcastStore,
  ],
  exports: [BotService],
})
export class BotModule {}
