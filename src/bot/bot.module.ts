import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { OpenBudgetModule } from '../openbudget/openbudget.module';
import { UserModule } from '../user/user.module';
import { VoteModule } from '../vote/vote.module';
import { BotService } from './bot.service';
import { AdminUpdate } from './admin/admin.update';
import { BroadcastService } from './admin/broadcast.service';
import { PendingBroadcastStore } from './admin/pending-broadcast.store';
import { BotThrottle } from './bot.throttle';
import { BotUpdate } from './bot.update';
import { VoteFlowService } from './vote-flow.service';
import { TelegramWebhookController } from './webhook.controller';

/** Telegram bot qatlami — grammY instansiyasi, handlerlar va conversation'lar. */
@Module({
  imports: [OpenBudgetModule, UserModule, VoteModule, AdminModule],
  controllers: [TelegramWebhookController],
  providers: [
    BotService,
    BotUpdate,
    BotThrottle,
    VoteFlowService,
    AdminUpdate,
    BroadcastService,
    PendingBroadcastStore,
  ],
  exports: [BotService],
})
export class BotModule {}
