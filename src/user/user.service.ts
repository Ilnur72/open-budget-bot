import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { maskPhone } from '../common/utils/mask-phone.util';
import { formatUzPhone } from '../common/utils/phone.util';

/** Telegram'dan keladigan profil ma'lumotlari — hammasi ixtiyoriy. */
export interface TelegramProfile {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}

/** Telegram foydalanuvchilari bilan ishlaydigan servis. */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Foydalanuvchini topadi, bo'lmasa yaratadi.
   * Profil (ism/username) har safar yangilanadi — Telegram'da o'zgargan bo'lishi mumkin.
   */
  async findOrCreate(telegramId: bigint, profile: TelegramProfile = {}): Promise<User> {
    const user = await this.prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...profile },
      // `isBlocked` qaytariladi: foydalanuvchi botga yozyapti, demak
      // bloklamagan. Aks holda bir marta bloklab, keyin ochgan odam
      // broadcast'lardan abadiy chiqib qolardi.
      update: { ...profile, isBlocked: false },
    });

    this.logger.debug(`Foydalanuvchi tayyor: id=${user.id}, telegramId=${telegramId}`);
    return user;
  }

  /** Telegram ID bo'yicha qidiradi. Topilmasa `null`. */
  async findByTelegramId(telegramId: bigint): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  /**
   * Oxirgi ishlatilgan telefon raqamni saqlaydi.
   * Raqam normalizatsiya qilinadi — `votes.phone` bilan bir xil formatda bo'lishi shart.
   */
  async updatePhone(userId: number, phone: string): Promise<User> {
    const normalized = formatUzPhone(phone);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: normalized },
    });

    // Log yozuvdan KEYIN — `update` yiqilsa "yangilandi" degan yolg'on iz qolmasin.
    this.logger.debug(`Telefon yangilandi: userId=${userId}, phone=${maskPhone(normalized)}`);
    return user;
  }
}
