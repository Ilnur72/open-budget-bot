import { Module } from '@nestjs/common';
import { OpenBudgetService } from './openbudget.service';
import { VoteRateLimiter } from './vote-rate-limiter.service';
import { VoteSessionStore } from './vote-session.store';

/** openbudget.uz API integratsiyasi: so'rovlar, sessiya holati va limitlar. */
@Module({
  providers: [OpenBudgetService, VoteSessionStore, VoteRateLimiter],
  exports: [OpenBudgetService, VoteSessionStore, VoteRateLimiter],
})
export class OpenBudgetModule {}
