import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma, VoteStatus, type Vote } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { DuplicateVoteError, InvalidPhoneError, VoteNotFoundError } from './vote.errors';
import { VoteService } from './vote.service';

const prismaMock = {
  vote: {
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  voteLog: { create: jest.fn() },
};

const configMock = { getOrThrow: jest.fn() };

const buildVote = (overrides: Partial<Vote> = {}): Vote => ({
  id: 1,
  userId: 1,
  phone: '+998901234567',
  initiativeUuid: 'uuid-1',
  districtId: 55,
  status: VoteStatus.PENDING,
  errorMessage: null,
  createdAt: new Date('2026-08-21T10:00:00Z'),
  ...overrides,
});

/** Qisman unikal indeks buzilganda Prisma qaytaradigan xatolikni taqlid qiladi. */
const duplicateIndexError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: { target: 'votes_initiative_phone_success_key' },
  });

const recordNotFoundError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '7.0.0',
  });

describe('VoteService', () => {
  let service: VoteService;

  beforeEach(async () => {
    jest.resetAllMocks();
    configMock.getOrThrow.mockReturnValue('Asia/Tashkent');
    prismaMock.vote.findFirst.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        VoteService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    service = moduleRef.get(VoteService);
  });

  describe('create', () => {
    it('PENDING holatida yozuv yaratadi', async () => {
      prismaMock.vote.create.mockResolvedValue(buildVote());

      await service.create(1, '+998901234567', 'uuid-1', 55);

      expect(prismaMock.vote.create).toHaveBeenCalledWith({
        data: { userId: 1, phone: '+998901234567', initiativeUuid: 'uuid-1', districtId: 55 },
      });
    });

    it('telefonni normalizatsiya qilib yozadi', async () => {
      prismaMock.vote.create.mockResolvedValue(buildVote());

      // Telegram kontakti raqamni `+` siz beradi.
      await service.create(1, '998901234567', 'uuid-1', 55);

      expect(prismaMock.vote.create).toHaveBeenCalledWith({
        data: { userId: 1, phone: '+998901234567', initiativeUuid: 'uuid-1', districtId: 55 },
      });
    });

    it('yaroqsiz raqamda InvalidPhoneError tashlaydi', async () => {
      await expect(service.create(1, '12345', 'uuid-1', 55)).rejects.toBeInstanceOf(
        InvalidPhoneError,
      );
      expect(prismaMock.vote.create).not.toHaveBeenCalled();
    });

    it('InvalidPhoneError raqamni maskalab saqlaydi', async () => {
      const error: unknown = await service
        .create(1, '+7 999 123 45 67', 'uuid-1', 55)
        .catch((caught: unknown) => caught);

      if (!(error instanceof InvalidPhoneError)) {
        throw new Error('InvalidPhoneError kutilgan edi');
      }
      expect(error.maskedPhone).not.toContain('9991234567');
    });

    it('allaqachon ovoz bergan raqamda SMS sarflamasdan rad etadi', async () => {
      prismaMock.vote.findFirst.mockResolvedValue({ id: 7 });

      await expect(service.create(1, '+998901234567', 'uuid-1', 55)).rejects.toBeInstanceOf(
        DuplicateVoteError,
      );
      expect(prismaMock.vote.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('holatni yangilaydi va errorMessage ni tozalaydi', async () => {
      prismaMock.vote.update.mockResolvedValue(buildVote({ status: VoteStatus.SUCCESS }));

      await service.updateStatus(1, VoteStatus.SUCCESS);

      expect(prismaMock.vote.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: VoteStatus.SUCCESS, errorMessage: null },
      });
    });

    it('xato xabarini saqlaydi', async () => {
      prismaMock.vote.update.mockResolvedValue(buildVote({ status: VoteStatus.FAILED }));

      await service.updateStatus(1, VoteStatus.FAILED, 'OTP xato');

      expect(prismaMock.vote.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: VoteStatus.FAILED, errorMessage: 'OTP xato' },
      });
    });

    it("dublikat indeks buzilganda qatorni FAILED ga o'tkazadi", async () => {
      prismaMock.vote.update
        .mockRejectedValueOnce(duplicateIndexError())
        .mockResolvedValueOnce(buildVote({ status: VoteStatus.FAILED }));

      await expect(service.updateStatus(1, VoteStatus.SUCCESS)).rejects.toBeInstanceOf(
        DuplicateVoteError,
      );

      // Qator PENDING bo'lib qotib qolmasligi kerak — aks holda statistika shishadi.
      expect(prismaMock.vote.update).toHaveBeenLastCalledWith({
        where: { id: 1 },
        data: { status: VoteStatus.FAILED, errorMessage: 'DUPLICATE_VOTE' },
      });
    });

    it('boshqa unikal cheklov buzilsa DuplicateVoteError deb talqin qilmaydi', async () => {
      const otherError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.0.0',
        meta: { target: 'some_other_unique_idx' },
      });
      prismaMock.vote.update.mockRejectedValue(otherError);

      await expect(service.updateStatus(1, VoteStatus.SUCCESS)).rejects.toBe(otherError);
    });

    it('yozuv topilmasa VoteNotFoundError tashlaydi', async () => {
      prismaMock.vote.update.mockRejectedValue(recordNotFoundError());

      await expect(service.updateStatus(404, VoteStatus.SUCCESS)).rejects.toBeInstanceOf(
        VoteNotFoundError,
      );
    });

    it("boshqa xatoliklarni o'zgartirmasdan uzatadi", async () => {
      prismaMock.vote.update.mockRejectedValue(new Error('ulanish uzildi'));

      await expect(service.updateStatus(1, VoteStatus.SUCCESS)).rejects.toThrow('ulanish uzildi');
    });
  });

  describe('hasSuccessfulVote', () => {
    it('faqat SUCCESS holatidagi ovozni, normalizatsiyalangan raqam bilan qidiradi', async () => {
      prismaMock.vote.findFirst.mockResolvedValue({ id: 7 });

      await expect(service.hasSuccessfulVote('998901234567', 'uuid-1')).resolves.toBe(true);
      expect(prismaMock.vote.findFirst).toHaveBeenCalledWith({
        where: { phone: '+998901234567', initiativeUuid: 'uuid-1', status: VoteStatus.SUCCESS },
        select: { id: true },
      });
    });

    it('topilmasa false', async () => {
      prismaMock.vote.findFirst.mockResolvedValue(null);
      await expect(service.hasSuccessfulVote('+998901234567', 'uuid-1')).resolves.toBe(false);
    });
  });

  describe('getStats', () => {
    it("groupBy natijasini bitta so'rovda yig'adi", async () => {
      prismaMock.vote.groupBy.mockResolvedValue([
        { status: VoteStatus.SUCCESS, _count: { _all: 10 } },
        { status: VoteStatus.FAILED, _count: { _all: 3 } },
        { status: VoteStatus.PENDING, _count: { _all: 2 } },
        { status: VoteStatus.CODE_SENT, _count: { _all: 1 } },
      ]);

      await expect(service.getStats()).resolves.toEqual({
        total: 16,
        success: 10,
        failed: 3,
        pending: 3,
      });
      expect(prismaMock.vote.groupBy).toHaveBeenCalledTimes(1);
    });

    it("ovoz bo'lmasa nollarni qaytaradi", async () => {
      prismaMock.vote.groupBy.mockResolvedValue([]);

      await expect(service.getStats()).resolves.toEqual({
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
      });
    });
  });

  describe('getTodayStats', () => {
    it("kun chegarasini APP_TIMEZONE bo'yicha qo'yadi", async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-21T02:00:00Z'));
      prismaMock.vote.groupBy.mockResolvedValue([]);

      await service.getTodayStats();

      // Tashkentda 07:00, 21-avgust -> kun boshi 20-avgust 19:00 UTC
      expect(prismaMock.vote.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { createdAt: { gte: new Date('2026-08-20T19:00:00.000Z') } },
        _count: { _all: true },
      });

      jest.useRealTimers();
    });
  });

  describe('getByUser', () => {
    it('default sahifalash bilan eng yangisidan beradi', async () => {
      prismaMock.vote.findMany.mockResolvedValue([]);

      await service.getByUser(1);

      expect(prismaMock.vote.findMany).toHaveBeenCalledWith({
        where: { userId: 1 },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
    });

    it('take ni maksimal chegara bilan cheklaydi', async () => {
      prismaMock.vote.findMany.mockResolvedValue([]);

      await service.getByUser(1, { take: 5000, skip: 40 });

      expect(prismaMock.vote.findMany).toHaveBeenCalledWith({
        where: { userId: 1 },
        orderBy: { createdAt: 'desc' },
        take: 100,
        skip: 40,
      });
    });

    it('manfiy qiymatlarni xavfsiz chegaraga keltiradi', async () => {
      prismaMock.vote.findMany.mockResolvedValue([]);

      // Prisma'da manfiy `take` teskari yo'nalishni bildiradi, manfiy `skip` esa xato.
      await service.getByUser(1, { take: -50, skip: -10 });

      expect(prismaMock.vote.findMany).toHaveBeenCalledWith({
        where: { userId: 1 },
        orderBy: { createdAt: 'desc' },
        take: 1,
        skip: 0,
      });
    });
  });

  describe('logAction', () => {
    it('details ichidagi telefonni maskalab yozadi', async () => {
      prismaMock.voteLog.create.mockResolvedValue({});

      await service.logAction(1, 'CODE_SENT', { phone: '+998901234567' });

      expect(prismaMock.voteLog.create).toHaveBeenCalledWith({
        data: { userId: 1, action: 'CODE_SENT', details: { phone: '+998***567' } },
      });
    });

    it('details berilmasa undefined uzatadi', async () => {
      prismaMock.voteLog.create.mockResolvedValue({});

      await service.logAction(1, 'VOTE_SUCCESS');

      expect(prismaMock.voteLog.create).toHaveBeenCalledWith({
        data: { userId: 1, action: 'VOTE_SUCCESS', details: undefined },
      });
    });
  });
  describe('failStaleVotes', () => {
    it("tashlab ketilgan urinishlarni FAILED ga o'tkazadi", async () => {
      prismaMock.vote.updateMany.mockResolvedValue({ count: 4 });
      const cutoff = new Date('2026-08-21T11:40:00Z');

      await expect(service.failStaleVotes(cutoff)).resolves.toBe(4);

      // Conversation timeout'i "lazy" — foydalanuvchi javob bermasa hech qanday
      // hodisa bo'lmaydi va yozuv PENDING da abadiy qolardi.
      expect(prismaMock.vote.updateMany).toHaveBeenCalledWith({
        where: {
          status: {
            in: [VoteStatus.PENDING, VoteStatus.CAPTCHA_SENT, VoteStatus.CODE_SENT],
          },
          createdAt: { lt: cutoff },
        },
        data: { status: VoteStatus.FAILED, errorMessage: 'TIMEOUT' },
      });
    });

    it('yakunlangan ovozlarga TEGMAYDI', async () => {
      prismaMock.vote.updateMany.mockResolvedValue({ count: 0 });

      await service.failStaleVotes(new Date());

      expect(prismaMock.vote.updateMany).toHaveBeenCalledWith({
        where: {
          status: {
            in: [VoteStatus.PENDING, VoteStatus.CAPTCHA_SENT, VoteStatus.CODE_SENT],
          },
          createdAt: { lt: expect.any(Date) as Date },
        },
        data: { status: VoteStatus.FAILED, errorMessage: 'TIMEOUT' },
      });
    });
  });
});
