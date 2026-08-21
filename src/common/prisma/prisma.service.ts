import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { toErrorInfo } from '../utils/error.util';

/**
 * PostgreSQL ulanishini NestJS hayot sikliga bog'laydi:
 * modul ko'tarilganda `$connect()`, ilova to'xtaganda `$disconnect()`.
 * Prisma 7 da ulanish manzili schema.prisma da emas — driver adapter orqali beriladi.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaPg(configService.getOrThrow<string>('database.url')),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log("PostgreSQL ulanishi o'rnatildi");
    } catch (error) {
      const { message, stack } = toErrorInfo(error);
      this.logger.error(`PostgreSQL ulanmadi: ${message}`, stack);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Xatolik chiqsa ham qolgan shutdown hook'lari bajarilishi kerak.
    try {
      await this.$disconnect();
      this.logger.log('PostgreSQL ulanishi yopildi');
    } catch (error) {
      this.logger.warn(`PostgreSQL toza yopilmadi: ${toErrorInfo(error).message}`);
    }
  }
}
