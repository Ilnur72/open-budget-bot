import { Module } from '@nestjs/common';
import { StaleVoteSweeper } from './stale-vote.sweeper';
import { VoteService } from './vote.service';

/** Ovoz berish yozuvlari moduli. */
@Module({
  providers: [VoteService, StaleVoteSweeper],
  exports: [VoteService],
})
export class VoteModule {}
