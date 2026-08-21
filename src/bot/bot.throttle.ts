import { Injectable } from '@nestjs/common';
import { ThrottleService } from '../common/throttle/throttle.service';

/** Bitta foydalanuvchidan oynada nechta update qabul qilinadi. */
const MAX_UPDATES_PER_WINDOW = 20;
const WINDOW_SECONDS = 60;

const KEY_PREFIX = 'bot:throttle';

/** Telegram update'lari uchun foydalanuvchi darajasidagi flood himoyasi. */
@Injectable()
export class BotThrottle {
  constructor(private readonly throttle: ThrottleService) {}

  /** Foydalanuvchi limitdan oshdimi. */
  async isFlooding(telegramId: number): Promise<boolean> {
    return this.throttle.isExceeded(
      `${KEY_PREFIX}:${telegramId}`,
      MAX_UPDATES_PER_WINDOW,
      WINDOW_SECONDS,
    );
  }
}
