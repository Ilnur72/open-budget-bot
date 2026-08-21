import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { VoteStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { VoteService } from '../vote/vote.service';
import { AdminService } from './admin.service';

const prismaMock = {
  user: { count: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  vote: { findMany: jest.fn(), count: jest.fn() },
  adminLog: { create: jest.fn() },
  $queryRaw: jest.fn(),
};

const voteServiceMock = { getStats: jest.fn(), getTodayStats: jest.fn() };
const configMock = { getOrThrow: jest.fn() };

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.resetAllMocks();
    voteServiceMock.getStats.mockResolvedValue({
      total: 100,
      success: 75,
      failed: 20,
      pending: 5,
    });
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.$queryRaw.mockResolvedValue([{ count: 60n }]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: ConfigService, useValue: configMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: VoteService, useValue: voteServiceMock },
      ],
    }).compile();
    service = moduleRef.get(AdminService);
  });

  describe('isAdmin', () => {
    it.each([
      [[111, 222], 111, true],
      [[111, 222], 333, false],
      [[], 111, false],
    ])('adminIds=%j, id=%s -> %s', (adminIds, telegramId, expected) => {
      configMock.getOrThrow.mockReturnValue(adminIds);

      expect(service.isAdmin(telegramId)).toBe(expected);
    });
  });

  describe('getStats', () => {
    it("statistikani yig'adi va foizni hisoblaydi", async () => {
      prismaMock.user.count.mockResolvedValueOnce(40).mockResolvedValueOnce(3);

      await expect(service.getStats()).resolves.toEqual({
        total: 100,
        success: 75,
        failed: 20,
        pending: 5,
        totalUsers: 40,
        blockedUsers: 3,
        uniqueSuccessfulPhones: 60,
        successRate: '75.0',
      });
    });

    it("ovoz bo'lmasa foiz 0.0", async () => {
      voteServiceMock.getStats.mockResolvedValue({ total: 0, success: 0, failed: 0, pending: 0 });

      await expect(service.getStats()).resolves.toMatchObject({ successRate: '0.0' });
    });

    it('unikal raqamlarni DB da sanaydi — hamma qatorni tortmaydi', async () => {
      await service.getStats();

      // `findMany({ distinct })` butun natijani xotiraga tortardi.
      expect(prismaMock.vote.findMany).not.toHaveBeenCalled();
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('getRecentVotes', () => {
    it('chegarani 10 tadan oshirmaydi', async () => {
      prismaMock.vote.findMany.mockResolvedValue([]);

      await service.getRecentVotes(999);

      expect(prismaMock.vote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, orderBy: { createdAt: 'desc' } }),
      );
    });

    it('manfiy chegarani xavfsiz qiladi', async () => {
      prismaMock.vote.findMany.mockResolvedValue([]);

      await service.getRecentVotes(-5);

      expect(prismaMock.vote.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    });
  });

  describe('getBroadcastTargets', () => {
    it('bloklanganlarni chiqarib, kursor bilan sahifalaydi', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      await service.getBroadcastTargets(42, 500);

      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: { isBlocked: false, id: { gt: 42 } },
        select: { id: true, telegramId: true },
        orderBy: { id: 'asc' },
        take: 500,
      });
    });

    it('birinchi sahifada kursor bermaydi', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      await service.getBroadcastTargets(null, 500);

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isBlocked: false } }),
      );
    });
  });

  describe('streamExportRows', () => {
    const voteRow = (id: number) => ({
      id,
      phone: '+998901234567',
      status: VoteStatus.SUCCESS,
      errorMessage: null,
      createdAt: new Date('2026-08-21T10:00:00Z'),
      user: { telegramId: 123456789012345n, username: 'ali' },
    });

    /** Generatordan barcha qatorlarni yig'adi. */
    const collect = async (masked?: boolean) => {
      const rows = [];
      for await (const chunk of service.streamExportRows(masked)) {
        rows.push(...chunk);
      }
      return rows;
    };

    it('BigInt telegramId ni satrga aylantiradi', async () => {
      prismaMock.vote.findMany.mockResolvedValueOnce([voteRow(1)]).mockResolvedValueOnce([]);

      const rows = await collect();

      // BigInt ni CSV/JSON ga to'g'ridan-to'g'ri qo'yib bo'lmaydi.
      expect(rows[0].telegramId).toBe('123456789012345');
      expect(typeof rows[0].telegramId).toBe('string');
    });

    it("sukut bo'yicha telefonni MASKALAYDI", async () => {
      prismaMock.vote.findMany.mockResolvedValueOnce([voteRow(1)]).mockResolvedValueOnce([]);

      const rows = await collect();

      // Fayl Telegram buluti ga chiqadi va u yerda muddatsiz qoladi.
      expect(rows[0].phone).toBe('+998***567');
    });

    it("aniq so'ralganda to'liq raqamni beradi", async () => {
      prismaMock.vote.findMany.mockResolvedValueOnce([voteRow(1)]).mockResolvedValueOnce([]);

      const rows = await collect(false);

      expect(rows[0].phone).toBe('+998901234567');
    });

    it("bo'laklab o'qiydi va kursorni oldinga suradi", async () => {
      prismaMock.vote.findMany
        .mockResolvedValueOnce([voteRow(10), voteRow(9)])
        .mockResolvedValueOnce([voteRow(8)])
        .mockResolvedValueOnce([]);

      const rows = await collect();

      expect(rows).toHaveLength(3);
      // Ikkinchi sahifa oxirgi id dan KEYIN boshlanadi.
      expect(prismaMock.vote.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { id: { lt: 9 } } }),
      );
    });

    it("bo'sh bazada hech narsa qaytarmaydi", async () => {
      prismaMock.vote.findMany.mockResolvedValueOnce([]);

      await expect(collect()).resolves.toEqual([]);
      expect(prismaMock.vote.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('logAction', () => {
    it('audit yozuvini yaratadi', async () => {
      prismaMock.adminLog.create.mockResolvedValue({});

      await service.logAction(555, 'EXPORT', { rows: 10 });

      expect(prismaMock.adminLog.create).toHaveBeenCalledWith({
        data: { adminId: 555n, action: 'EXPORT', details: { rows: 10 } },
      });
    });

    it("audit yozuvi yiqilsa ham amalni to'xtatmaydi", async () => {
      prismaMock.adminLog.create.mockRejectedValue(new Error('DB uzildi'));

      await expect(service.logAction(555, 'EXPORT')).resolves.toBeUndefined();
    });
  });
});
