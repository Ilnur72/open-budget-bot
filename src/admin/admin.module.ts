import { Module } from '@nestjs/common';
import { VoteModule } from '../vote/vote.module';
import { AdminService } from './admin.service';

/**
 * Admin paneli moduli.
 * Broadcast ATAYLAB bu yerda emas, `bot/` qatlamida: u `BotService` ga muhtoj,
 * `BotModule` esa allaqachon `AdminModule` ni import qiladi — teskarisi
 * aylanma bog'liqlik yaratardi.
 */
@Module({
  imports: [VoteModule],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
