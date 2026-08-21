import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Vote } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { maskPhone } from '../common/utils/mask-phone.util';
import { VoteService, type VoteStats } from '../vote/vote.service';

/** `/recent` da ko'rsatiladigan ovozlar soni. */
const RECENT_VOTES_LIMIT = 10;

/** Eksport bir marta shuncha qatordan oshmaydi. */
const EXPORT_MAX_ROWS = 50_000;

/** Bir bo'lakda shuncha qator o'qiladi. */
const EXPORT_CHUNK_SIZE = 5_000;

/** Audit iziga yoziladigan admin amallari. */
export const ADMIN_ACTIONS = ['EXPORT', 'BROADCAST_PREPARED', 'BROADCAST_SENT'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** Kengaytirilgan statistika. */
export interface AdminStats extends VoteStats {
  totalUsers: number;
  blockedUsers: number;
  uniqueSuccessfulPhones: number;
  /** Muvaffaqiyat foizi, bir kasr belgi bilan */
  successRate: string;
}

/** `/recent` uchun ovoz va uning egasi. */
export type VoteWithUser = Vote & {
  user: { firstName: string | null; username: string | null };
};

/** Eksport so'rovi qaytaradigan yozuv shakli. */
type ExportVote = Prisma.VoteGetPayload<{
  include: { user: { select: { telegramId: true; username: true } } };
}>;

/** Eksport uchun bitta qator. */
export interface ExportRow {
  voteId: number;
  createdAt: Date;
  telegramId: string;
  username: string | null;
  phone: string;
  status: string;
  errorMessage: string | null;
}

/**
 * Admin uchun ma'lumot yig'adigan servis.
 *
 * Bu yerda BOT bilan ishlash yo'q (broadcast va boshqalar `bot/` qatlamida):
 * `BotModule` allaqachon `AdminModule` ni import qiladi, teskarisi aylanma
 * bog'liqlik yaratardi.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly voteService: VoteService,
  ) {}

  /** Telegram user ID admin ro'yxatida bor-yo'qligini tekshiradi. */
  isAdmin(telegramId: number): boolean {
    return this.configService.getOrThrow<number[]>('bot.adminIds').includes(telegramId);
  }

  /** Umumiy statistika. */
  async getStats(): Promise<AdminStats> {
    const [votes, totalUsers, blockedUsers, uniqueSuccessfulPhones] = await Promise.all([
      this.voteService.getStats(),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isBlocked: true } }),
      this.countUniqueSuccessfulPhones(),
    ]);

    return {
      ...votes,
      totalUsers,
      blockedUsers,
      uniqueSuccessfulPhones,
      successRate: formatRate(votes.success, votes.total),
    };
  }

  /** Bugungi statistika — kun chegarasi `APP_TIMEZONE` bo'yicha. */
  async getTodayStats(): Promise<VoteStats & { successRate: string }> {
    const stats = await this.voteService.getTodayStats();
    return { ...stats, successRate: formatRate(stats.success, stats.total) };
  }

  /** Oxirgi ovoz urinishlari. */
  async getRecentVotes(limit = RECENT_VOTES_LIMIT): Promise<VoteWithUser[]> {
    return this.prisma.vote.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Math.trunc(limit), 1), RECENT_VOTES_LIMIT),
      include: { user: { select: { firstName: true, username: true } } },
    });
  }

  /**
   * Broadcast uchun bloklanmagan foydalanuvchilar.
   * Sahifalab beriladi — 100k foydalanuvchini xotiraga yig'ishning ma'nosi yo'q.
   */
  async getBroadcastTargets(
    cursor: number | null,
    take: number,
  ): Promise<{ id: number; telegramId: bigint }[]> {
    return this.prisma.user.findMany({
      where: { isBlocked: false, ...(cursor === null ? {} : { id: { gt: cursor } }) },
      select: { id: true, telegramId: true },
      orderBy: { id: 'asc' },
      take,
    });
  }

  /** Foydalanuvchini bloklangan deb belgilaydi (botni bloklaganda). */
  async markBlocked(userId: number): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { isBlocked: true } });
  }

  /** Eksportga tushadigan umumiy yozuvlar soni (kesilganini bilish uchun). */
  async countExportRows(): Promise<number> {
    return this.prisma.vote.count();
  }

  /**
   * CSV eksport qatorlarini BO'LAKLAB beradi.
   *
   * Hammasini bir marta olish 50k qatorda ~300 MB RSS talab qilardi (Prisma
   * obyektlari + map natijasi + CSV satri bir vaqtda xotirada) — 512 MB
   * konteynerda bu OOM degani.
   *
   * Telefon raqamlar sukut bo'yicha MASKALANADI: fayl Telegram buluti ga
   * chiqadi va u yerda muddatsiz qoladi.
   */
  async *streamExportRows(
    masked = true,
    chunkSize = EXPORT_CHUNK_SIZE,
  ): AsyncGenerator<ExportRow[]> {
    let cursor: number | null = null;

    for (let sent = 0; sent < EXPORT_MAX_ROWS;) {
      const page: ExportVote[] = await this.prisma.vote.findMany({
        where: cursor === null ? {} : { id: { lt: cursor } },
        orderBy: { id: 'desc' },
        take: Math.min(chunkSize, EXPORT_MAX_ROWS - sent),
        include: { user: { select: { telegramId: true, username: true } } },
      });

      if (page.length === 0) {
        return;
      }

      yield page.map((vote) => ({
        voteId: vote.id,
        createdAt: vote.createdAt,
        // BigInt ni JSON/CSV ga to'g'ridan-to'g'ri qo'yib bo'lmaydi.
        telegramId: vote.user.telegramId.toString(),
        username: vote.user.username,
        phone: masked ? maskPhone(vote.phone) : vote.phone,
        status: vote.status,
        errorMessage: vote.errorMessage,
      }));

      sent += page.length;
      cursor = page[page.length - 1].id;
    }
  }

  /**
   * Admin amalini audit iziga yozadi.
   *
   * Usiz kim eksport qilgani yoki kim butun bazaga xabar yuborgani
   * aniqlanmasdi — buzilgan admin hisobini tergov qilishning imkoni yo'q edi.
   */
  async logAction(
    adminId: number,
    action: AdminAction,
    details?: Prisma.InputJsonObject,
  ): Promise<void> {
    try {
      await this.prisma.adminLog.create({
        data: { adminId: BigInt(adminId), action, details },
      });
    } catch (error) {
      // Audit yozuvi yiqilsa ham amal bajarilishi kerak — lekin bu jiddiy signal.
      this.logger.error(`Admin audit yozilmadi: ${action}, ${(error as Error).message}`);
    }
  }

  /**
   * Muvaffaqiyatli ovoz bergan unikal raqamlar soni.
   *
   * `findMany({ distinct })` butun natijani xotiraga tortardi — bu yerda
   * DB'ning o'zi sanaydi.
   */
  private async countUniqueSuccessfulPhones(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT phone) AS count FROM votes WHERE status = 'SUCCESS'
    `;
    return Number(rows[0]?.count ?? 0);
  }
}

/** Foizni bir kasr belgi bilan yozadi. */
function formatRate(part: number, total: number): string {
  return total > 0 ? ((part / total) * 100).toFixed(1) : '0.0';
}
