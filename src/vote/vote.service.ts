import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VoteStatus, type Vote, type VoteLog } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { startOfDayInTimeZone } from '../common/utils/date.util';
import { maskPhone } from '../common/utils/mask-phone.util';
import { formatUzPhone, isValidUzPhone } from '../common/utils/phone.util';
import { DuplicateVoteError, InvalidPhoneError, VoteNotFoundError } from './vote.errors';

/** `getByUser` uchun sahifalash chegaralari. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Prisma xatolik kodlari. */
const UNIQUE_CONSTRAINT_ERROR = 'P2002';
const RECORD_NOT_FOUND_ERROR = 'P2025';

/** Dublikat ovozni to'sadigan qisman unikal indeks nomi. */
const DUPLICATE_SUCCESS_INDEX = 'votes_initiative_phone_success_key';

/** Dublikat sababli rad etilgan ovozning `errorMessage` qiymati. */
const DUPLICATE_ERROR_MESSAGE = 'DUPLICATE_VOTE';

/** `vote_logs.action` uchun ruxsat etilgan qiymatlar. */
export const VOTE_ACTIONS = [
  'CAPTCHA_REQUESTED',
  'CODE_SENT',
  'CODE_VERIFIED',
  'VOTE_SUCCESS',
  'VOTE_FAILED',
] as const;

export type VoteAction = (typeof VOTE_ACTIONS)[number];

/** Ovozlar bo'yicha yig'ma statistika. */
export interface VoteStats {
  total: number;
  success: number;
  failed: number;
  /** Hali yakunlanmagan urinishlar (PENDING, CAPTCHA_SENT, CODE_SENT, VERIFIED) */
  pending: number;
}

/** Ovoz berish yozuvlari va statistikasi bilan ishlaydigan servis. */
@Injectable()
export class VoteService {
  private readonly logger = new Logger(VoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Yangi ovoz urinishini `PENDING` holatida yaratadi.
   *
   * Telefon normalizatsiya qilinadi — turli formatdagi bir xil raqam
   * (`998...` va `+998...`) dublikat himoyasini chetlab o'tmasligi uchun.
   * Dublikat oldindan tekshiriladi: aks holda foydalanuvchi captcha yechib,
   * SMS olib, OTP kiritgandan keyingina rad javob olardi.
   */
  async create(
    userId: number,
    phone: string,
    initiativeUuid: string,
    districtId: number,
  ): Promise<Vote> {
    const normalized = formatUzPhone(phone);
    if (!isValidUzPhone(normalized)) {
      throw new InvalidPhoneError(maskPhone(phone));
    }

    // Tez rad javob — SMS/captcha sarflanmasidan oldin.
    // Yakuniy kafolat baribir DB indeksida (race condition'dan himoya).
    if (await this.hasSuccessfulVote(normalized, initiativeUuid)) {
      throw new DuplicateVoteError(initiativeUuid);
    }

    const vote = await this.prisma.vote.create({
      data: { userId, phone: normalized, initiativeUuid, districtId },
    });

    this.logger.log(
      `Ovoz urinishi yaratildi: voteId=${vote.id}, userId=${userId}, phone=${maskPhone(normalized)}`,
    );
    return vote;
  }

  /**
   * Ovoz holatini yangilaydi.
   * `SUCCESS` ga o'tkazishda DB'dagi qisman unikal indeks dublikatni bloklaydi —
   * bu race condition'dan ham himoya qiladi (bir vaqtda ikkita urinish).
   */
  async updateStatus(voteId: number, status: VoteStatus, errorMessage?: string): Promise<Vote> {
    try {
      const vote = await this.prisma.vote.update({
        where: { id: voteId },
        data: { status, errorMessage: errorMessage ?? null },
      });

      this.logger.log(`Ovoz holati: voteId=${voteId} -> ${status}`);
      return vote;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
        throw error;
      }

      if (
        error.code === UNIQUE_CONSTRAINT_ERROR &&
        violatedConstraint(error.meta?.target).includes(DUPLICATE_SUCCESS_INDEX)
      ) {
        // UPDATE yiqilganda qator eski holatida qoladi. Uni FAILED ga o'tkazmasak,
        // ovoz abadiy PENDING bo'lib qolib statistikani shishiradi.
        const vote = await this.prisma.vote.update({
          where: { id: voteId },
          data: { status: VoteStatus.FAILED, errorMessage: DUPLICATE_ERROR_MESSAGE },
        });

        this.logger.warn(`Dublikat ovoz bloklandi: voteId=${voteId}`);
        throw new DuplicateVoteError(vote.initiativeUuid);
      }

      if (error.code === RECORD_NOT_FOUND_ERROR) {
        throw new VoteNotFoundError(voteId);
      }

      throw error;
    }
  }

  /** Telefon raqam ushbu tashabbusga allaqachon muvaffaqiyatli ovoz berganmi? */
  async hasSuccessfulVote(phone: string, initiativeUuid: string): Promise<boolean> {
    const existing = await this.prisma.vote.findFirst({
      where: { phone: formatUzPhone(phone), initiativeUuid, status: VoteStatus.SUCCESS },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * Tashlab ketilgan urinishlarni yopadi.
   *
   * Kerak, chunki grammY conversation timeout'i "lazy": foydalanuvchi umuman
   * javob bermasa hech qanday hodisa bo'lmaydi va yozuv PENDING holatida
   * abadiy qolib, statistikani shishirardi.
   */
  async failStaleVotes(olderThan: Date): Promise<number> {
    const { count } = await this.prisma.vote.updateMany({
      where: {
        status: { in: [VoteStatus.PENDING, VoteStatus.CAPTCHA_SENT, VoteStatus.CODE_SENT] },
        createdAt: { lt: olderThan },
      },
      data: { status: VoteStatus.FAILED, errorMessage: 'TIMEOUT' },
    });

    if (count > 0) {
      this.logger.log(`Tashlab ketilgan ${count} ta ovoz yopildi`);
    }
    return count;
  }

  /** Umumiy statistika. */
  async getStats(): Promise<VoteStats> {
    return this.aggregate();
  }

  /**
   * Bugungi statistika.
   * Kun chegarasi `APP_TIMEZONE` bo'yicha hisoblanadi — server UTC'da ishlasa ham
   * "bugun" O'zbekiston kunini bildiradi.
   */
  async getTodayStats(): Promise<VoteStats> {
    const timeZone = this.configService.getOrThrow<string>('app.timeZone');
    return this.aggregate({ createdAt: { gte: startOfDayInTimeZone(timeZone) } });
  }

  /** Foydalanuvchining ovozlari — eng yangisidan boshlab, sahifalab. */
  async getByUser(userId: number, options: { take?: number; skip?: number } = {}): Promise<Vote[]> {
    // Prisma'da manfiy `take` teskari yo'nalishni bildiradi, manfiy `skip` esa
    // validatsiya xatosi beradi — admin buyrug'idan kelgan qiymatni qisamiz.
    const take = Math.min(
      Math.max(Math.trunc(options.take ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const skip = Math.max(Math.trunc(options.skip ?? 0), 0);

    return this.prisma.vote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Ovoz oqimidagi qadamni audit uchun yozib qo'yadi.
   * `details` ichidagi telefon maskalanadi — DB'ga ochiq raqam tushmasin.
   */
  async logAction(
    userId: number,
    action: VoteAction,
    details?: Prisma.InputJsonObject,
  ): Promise<VoteLog> {
    return this.prisma.voteLog.create({
      data: { userId, action, details: details && redactDetails(details) },
    });
  }

  /**
   * Statistikani bitta `groupBy` so'rovi bilan yig'adi —
   * har bir holat uchun alohida `count` yubormaslik uchun.
   */
  private async aggregate(where?: Prisma.VoteWhereInput): Promise<VoteStats> {
    const grouped = await this.prisma.vote.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
    const total = grouped.reduce((sum, row) => sum + row._count._all, 0);
    const success = counts.get(VoteStatus.SUCCESS) ?? 0;
    const failed = counts.get(VoteStatus.FAILED) ?? 0;

    return { total, success, failed, pending: total - success - failed };
  }
}

/**
 * Prisma P2002 xatoligidagi buzilgan cheklov nomini o'qiydi.
 * Postgres'da `meta.target` satr yoki satrlar massivi bo'lishi mumkin.
 */
function violatedConstraint(target: unknown): string {
  if (typeof target === 'string') {
    return target;
  }
  if (Array.isArray(target)) {
    return target.filter((item): item is string => typeof item === 'string').join(',');
  }
  return '';
}

/** Audit `details` ichidagi `phone` maydonini maskalaydi. */
function redactDetails(details: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const { phone } = details;
  return typeof phone === 'string' ? { ...details, phone: maskPhone(phone) } : details;
}
