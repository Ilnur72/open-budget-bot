import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';

/** Tasdiqlanmagan broadcast matni shuncha vaqt saqlanadi. */
const TTL_SECONDS = 5 * 60;

/** Xabar uzunligi chegarasi (Telegram xabar chegarasi 4096). */
export const MAX_BROADCAST_LENGTH = 3500;

const KEY_PREFIX = 'admin:broadcast:pending';

/**
 * Tasdiqlanishi kutilayotgan broadcast matnini saqlaydi.
 *
 * Har bir matn o'z ID siga ega va tugmaning `callback_data` siga aynan shu ID
 * yoziladi. Aks holda admin ketma-ket ikkita `/broadcast` yuborsa, ESKI
 * tugmani bosganda YANGI matn ketardi — ya'ni ekranda ko'ringan matn
 * yuborilayotgan matn bo'lmasdi.
 */
@Injectable()
export class PendingBroadcastStore {
  constructor(private readonly redisService: RedisService) {}

  /** Matnni saqlaydi va uning identifikatorini qaytaradi. */
  async save(adminId: number, text: string): Promise<string> {
    const id = randomUUID();
    await this.redisService.client.set(this.key(adminId, id), text, 'EX', TTL_SECONDS);
    return id;
  }

  /** Matnni o'qiydi va darhol o'chiradi — ikki marta yuborilmasin. */
  async take(adminId: number, id: string): Promise<string | null> {
    const key = this.key(adminId, id);
    const [[, value]] = (await this.redisService.client.multi().get(key).del(key).exec()) ?? [[]];
    return typeof value === 'string' ? value : null;
  }

  async clear(adminId: number, id: string): Promise<void> {
    await this.redisService.client.del(this.key(adminId, id));
  }

  private key(adminId: number, id: string): string {
    return `${KEY_PREFIX}:${adminId}:${id}`;
  }
}
