import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { toErrorInfo } from '../common/utils/error.util';
import { VoteService } from './vote.service';

/** Tozalash qanchalik tez-tez ishlaydi. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Shundan eski yakunlanmagan urinishlar tashlab ketilgan deb hisoblanadi. */
const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * Tashlab ketilgan ovoz urinishlarini davriy ravishda yopadi.
 *
 * `@nestjs/schedule` o'rniga oddiy `setInterval`: bitta vazifa uchun yangi
 * bog'liqlik qo'shishning ma'nosi yo'q. Timer `unref()` qilingan — u
 * process'ning chiqishiga to'sqinlik qilmaydi.
 */
@Injectable()
export class StaleVoteSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaleVoteSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly voteService: VoteService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    this.logger.log('Tashlab ketilgan ovozlar tozalagichi ishga tushdi');
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Bir marta tozalash — testdan ham chaqirsa bo'ladi. */
  async sweep(): Promise<void> {
    try {
      await this.voteService.failStaleVotes(new Date(Date.now() - STALE_AFTER_MS));
    } catch (error) {
      // Tozalash yiqilsa ilova ishlashda davom etsin.
      this.logger.error(`Tozalash yiqildi: ${toErrorInfo(error).message}`);
    }
  }
}
