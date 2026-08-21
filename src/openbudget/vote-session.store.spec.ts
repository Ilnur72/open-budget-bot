import { Test } from '@nestjs/testing';
import { RedisService } from '../common/redis/redis.service';
import { OtpAttemptsExhaustedError } from './openbudget.errors';
import { VoteSessionStore } from './vote-session.store';

const clientMock = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
};

const redisMock = { client: clientMock };

const KEY = 'openbudget:session:123';

/** Saqlangan payload'ni tekshiradi — JSON kalitlari tartibiga bog'lanib qolmaslik uchun. */
const expectStored = (expected: unknown, ttl: number): void => {
  const [key, raw, mode, seconds] = clientMock.set.mock.calls.at(-1) as [
    string,
    string,
    string,
    number,
  ];
  expect(key).toBe(KEY);
  expect(JSON.parse(raw)).toEqual(expected);
  expect(mode).toBe('EX');
  expect(seconds).toBe(ttl);
};
const CAPTCHA = { imageA: 'AAA', imageB: 'BBB', cookie: 'SESSION=KEY' };
const FRESH = { imageA: 'AAA', imageB: 'BBB', cookie: 'SESSION=KEY', otpAttempts: 0 };
const SENT = { ...FRESH, phone: '+998901234567' };

describe('VoteSessionStore', () => {
  let store: VoteSessionStore;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [VoteSessionStore, { provide: RedisService, useValue: redisMock }],
    }).compile();
    store = moduleRef.get(VoteSessionStore);
  });

  describe('startCaptcha', () => {
    it('captcha kaliti va RASMLARINI saqlaydi', async () => {
      await store.startCaptcha(123, CAPTCHA);

      // Rasmlar shu yerda saqlanishi shart: WebApp qayta `getCaptcha()`
      // chaqirsa boshqa kalit kelib, yechim hech qachon to'g'ri kelmasdi.
      expectStored(FRESH, 900);
    });
  });

  describe('attachSentCode', () => {
    it("mavjud sessiyaga telefon va tokenni qo'shadi", async () => {
      clientMock.get.mockResolvedValue(JSON.stringify(FRESH));

      await store.attachSentCode(123, '+998901234567', 'SESSION=KEY');

      // SMS yuborilgach TTL qisqaradi — gr_token uzoq yashamasin.
      expectStored(SENT, 300);
    });

    it("sessiya yo'q bo'lsa xatolik beradi", async () => {
      clientMock.get.mockResolvedValue(null);

      await expect(store.attachSentCode(123, '+998901234567', 'SESSION=KEY')).rejects.toThrow();
    });
  });

  describe('get', () => {
    it('saqlangan sessiyani qaytaradi', async () => {
      clientMock.get.mockResolvedValue(JSON.stringify(SENT));

      await expect(store.get(123)).resolves.toEqual(SENT);
    });

    it("muddati o'tgan sessiyada null qaytaradi", async () => {
      clientMock.get.mockResolvedValue(null);

      await expect(store.get(123)).resolves.toBeNull();
    });

    it.each([
      ['"123"', 'raqam'],
      ['{"a":1}', "captchaKey yo'q"],
      ['{"imageA":"A","imageB":"B","cookie":123}', 'cookie satr emas'],
      ['{"cookie":"K"}', "rasmlar yo'q"],
      ['null', 'null'],
      ['{ buzilgan json', 'sintaksis xatosi'],
    ])('shakli buzilgan yozuvni (%s — %s) tozalab null qaytaradi', async (raw) => {
      clientMock.get.mockResolvedValue(raw);

      await expect(store.get(123)).resolves.toBeNull();
      expect(clientMock.del).toHaveBeenCalledWith(KEY);
    });
  });

  describe('getConfirmable', () => {
    it('SMS yuborilgan sessiyani qaytaradi', async () => {
      clientMock.get.mockResolvedValue(JSON.stringify(SENT));

      await expect(store.getConfirmable(123)).resolves.toEqual(SENT);
    });

    it("SMS hali yuborilmagan bo'lsa null", async () => {
      clientMock.get.mockResolvedValue(JSON.stringify(FRESH));

      await expect(store.getConfirmable(123)).resolves.toBeNull();
    });
  });

  describe('consumeOtpAttempt', () => {
    it('urinishni hisoblaydi va TTL ni saqlaydi', async () => {
      clientMock.get.mockResolvedValue(JSON.stringify(SENT));
      clientMock.ttl.mockResolvedValue(200);

      await store.consumeOtpAttempt(123);

      // TTL yangilanmasligi kerak — sessiya umri urinishlar bilan cho'zilmasin.
      expectStored({ ...SENT, otpAttempts: 1 }, 200);
    });

    it('3 ta haqiqiy urinish beradi (konstanta 3 => 3)', async () => {
      clientMock.ttl.mockResolvedValue(200);
      clientMock.get.mockResolvedValue(JSON.stringify({ ...SENT, otpAttempts: 2 }));

      // 3-urinish hali o'tishi kerak — avval `>=` bilan 2 ta bo'lib qolgan edi.
      await expect(store.consumeOtpAttempt(123)).resolves.toBeUndefined();
    });

    it("urinishlar tugasa sessiyani o'chiradi", async () => {
      clientMock.get.mockResolvedValue(JSON.stringify({ ...SENT, otpAttempts: 3 }));

      await expect(store.consumeOtpAttempt(123)).rejects.toBeInstanceOf(OtpAttemptsExhaustedError);
      expect(clientMock.del).toHaveBeenCalledWith(KEY);
    });

    it("sessiya yo'q bo'lsa xatolik beradi", async () => {
      clientMock.get.mockResolvedValue(null);

      await expect(store.consumeOtpAttempt(123)).rejects.toBeInstanceOf(OtpAttemptsExhaustedError);
    });
  });

  describe('clear', () => {
    it("sessiyani o'chiradi", async () => {
      await store.clear(123);

      expect(clientMock.del).toHaveBeenCalledWith(KEY);
    });
  });
});
