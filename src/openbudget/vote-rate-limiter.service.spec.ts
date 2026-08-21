import { Test } from '@nestjs/testing';
import { RedisService } from '../common/redis/redis.service';
import { InvalidPhoneError } from '../vote/vote.errors';
import {
  ManualPhoneQuotaExceededError,
  PhoneRateLimitedError,
  RateLimiterUnavailableError,
  UserQuotaExceededError,
} from './openbudget.errors';
import { VoteRateLimiter } from './vote-rate-limiter.service';

const execMock = jest.fn();
const multiMock = {
  incr: jest.fn(),
  expire: jest.fn(),
  exec: execMock,
};

const clientMock = {
  multi: jest.fn(),
  ttl: jest.fn(),
  get: jest.fn(),
  decr: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
};

const redisMock = { client: clientMock };

const PHONE_KEY = 'openbudget:ratelimit:phone:+998901234567';
const USER_KEY = 'openbudget:ratelimit:user:555';
const MANUAL_KEY = 'openbudget:ratelimit:manual:555';

/** Muvaffaqiyatli MULTI natijasi: INCR va EXPIRE javoblari. */
const okExec = (incrValue: number) => [
  [null, incrValue],
  [null, 1],
];

describe('VoteRateLimiter', () => {
  let limiter: VoteRateLimiter;

  beforeEach(async () => {
    jest.clearAllMocks();
    clientMock.multi.mockReturnValue(multiMock);
    multiMock.incr.mockReturnValue(multiMock);
    multiMock.expire.mockReturnValue(multiMock);
    clientMock.ttl.mockResolvedValue(3600);

    const moduleRef = await Test.createTestingModule({
      providers: [VoteRateLimiter, { provide: RedisService, useValue: redisMock }],
    }).compile();
    limiter = moduleRef.get(VoteRateLimiter);
  });

  describe('consumePhone', () => {
    it("birinchi urinishga ruxsat beradi va TTL qo'yadi", async () => {
      execMock.mockResolvedValue(okExec(1));

      await expect(limiter.consumePhone('998901234567')).resolves.toBeUndefined();
      expect(multiMock.incr).toHaveBeenCalledWith(PHONE_KEY);
      expect(multiMock.expire).toHaveBeenCalledWith(PHONE_KEY, 86400, 'NX');
    });

    it('ikkinchi urinishni bloklaydi', async () => {
      execMock.mockResolvedValue(okExec(2));

      await expect(limiter.consumePhone('+998901234567')).rejects.toBeInstanceOf(
        PhoneRateLimitedError,
      );
    });

    it('bloklangan urinish hisoblagichni shishirmaydi', async () => {
      execMock.mockResolvedValue(okExec(2));

      await expect(limiter.consumePhone('+998901234567')).rejects.toBeInstanceOf(
        PhoneRateLimitedError,
      );
      // DECR bo'lmasa keyingi refund qiymatni 1 dan pastga tushira olmasdi
      // va foydalanuvchi ovoz bermagan holda 24 soatga qulflanardi.
      expect(clientMock.decr).toHaveBeenCalledWith(PHONE_KEY);
    });

    it("raqam formatidan qat'i nazar bir xil kalitni ishlatadi", async () => {
      execMock.mockResolvedValue(okExec(1));

      await limiter.consumePhone('901234567');
      expect(multiMock.incr).toHaveBeenCalledWith(PHONE_KEY);
    });

    it("yaroqsiz raqamni rad etadi — buzuq inputlar bitta kalitni bo'lishmasin", async () => {
      await expect(limiter.consumePhone('+998')).rejects.toBeInstanceOf(InvalidPhoneError);
      expect(multiMock.incr).not.toHaveBeenCalled();
    });

    describe('fail-closed', () => {
      it('exec() null qaytarsa ruxsat bermaydi', async () => {
        execMock.mockResolvedValue(null);

        await expect(limiter.consumePhone('+998901234567')).rejects.toBeInstanceOf(
          RateLimiterUnavailableError,
        );
      });

      it('INCR xato bersa ruxsat bermaydi', async () => {
        execMock.mockResolvedValue([
          [new Error('WRONGTYPE'), null],
          [null, 1],
        ]);

        await expect(limiter.consumePhone('+998901234567')).rejects.toBeInstanceOf(
          RateLimiterUnavailableError,
        );
      });

      it('INCR raqam qaytarmasa ruxsat bermaydi', async () => {
        execMock.mockResolvedValue([
          [null, 'nima'],
          [null, 1],
        ]);

        await expect(limiter.consumePhone('+998901234567')).rejects.toBeInstanceOf(
          RateLimiterUnavailableError,
        );
      });
    });

    it("EXPIRE xato bersa TTL ni zaxira yo'l bilan qo'yadi", async () => {
      // Redis 6.x da `EXPIRE ... NX` yo'q, MULTI esa rollback qilmaydi —
      // TTL'siz kalit raqamni abadiy bloklardi.
      execMock.mockResolvedValue([
        [null, 1],
        [new Error('ERR Unsupported option NX'), null],
      ]);

      await expect(limiter.consumePhone('+998901234567')).resolves.toBeUndefined();
      expect(clientMock.expire).toHaveBeenCalledWith(PHONE_KEY, 86400);
    });
  });

  describe('consumeUser', () => {
    it('kontakt orqali kunlik kvota ichida ruxsat beradi', async () => {
      execMock.mockResolvedValue(okExec(3));

      await expect(limiter.consumeUser(555, 'contact')).resolves.toBeUndefined();
      expect(multiMock.incr).toHaveBeenCalledWith(USER_KEY);
      expect(multiMock.incr).not.toHaveBeenCalledWith(MANUAL_KEY);
    });

    it('umumiy kvota oshsa bloklaydi', async () => {
      execMock.mockResolvedValue(okExec(4));

      await expect(limiter.consumeUser(555, 'contact')).rejects.toBeInstanceOf(
        UserQuotaExceededError,
      );
      expect(clientMock.decr).toHaveBeenCalledWith(USER_KEY);
    });

    it("qo'lda kiritishda IKKALA hisoblagich sarflanadi", async () => {
      execMock.mockResolvedValue(okExec(1));

      await expect(limiter.consumeUser(555, 'manual')).resolves.toBeUndefined();

      // Umumiy kvota ham sarflanadi — aks holda 3 kontakt + 1 qo'lda = 4 ta SMS bo'lardi.
      expect(multiMock.incr).toHaveBeenCalledWith(USER_KEY);
      expect(multiMock.incr).toHaveBeenCalledWith(MANUAL_KEY);
    });

    it("qo'lda kiritish limiti oshsa bloklaydi va umumiy kvotani qaytaradi", async () => {
      execMock
        .mockResolvedValueOnce(okExec(1)) // umumiy kvota — o'tadi
        .mockResolvedValueOnce(okExec(2)); // qo'lda kiritish — oshib ketdi

      await expect(limiter.consumeUser(555, 'manual')).rejects.toBeInstanceOf(
        ManualPhoneQuotaExceededError,
      );

      expect(clientMock.decr).toHaveBeenCalledWith(MANUAL_KEY);
      expect(clientMock.decr).toHaveBeenCalledWith(USER_KEY);
    });
  });

  describe('refundUndeliveredSms', () => {
    it("hisoblagichni qaytaradi va nolga tushsa kalitni o'chiradi", async () => {
      clientMock.decr.mockResolvedValue(0);

      await limiter.refundUndeliveredSms('+998901234567');

      expect(clientMock.decr).toHaveBeenCalledWith(PHONE_KEY);
      expect(clientMock.del).toHaveBeenCalledWith(PHONE_KEY);
    });

    it('hisoblagich musbat qolsa kalitni saqlaydi', async () => {
      clientMock.decr.mockResolvedValue(1);

      await limiter.refundUndeliveredSms('+998901234567');

      expect(clientMock.del).not.toHaveBeenCalled();
    });
  });

  describe('isPhoneExhausted', () => {
    it("limit tugagan bo'lsa true", async () => {
      clientMock.get.mockResolvedValue('1');
      await expect(limiter.isPhoneExhausted('+998901234567')).resolves.toBe(true);
    });

    it("yozuv yo'q bo'lsa false", async () => {
      clientMock.get.mockResolvedValue(null);
      await expect(limiter.isPhoneExhausted('+998901234567')).resolves.toBe(false);
    });
  });
});
