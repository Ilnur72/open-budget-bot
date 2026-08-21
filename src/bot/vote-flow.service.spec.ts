import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { VoteStatus } from '@prisma/client';
import {
  CaptchaQuotaExceededError,
  ManualPhoneQuotaExceededError,
  OpenBudgetUnavailableError,
  OtpAttemptsExhaustedError,
  PhoneRateLimitedError,
} from '../openbudget/openbudget.errors';
import { OpenBudgetService } from '../openbudget/openbudget.service';
import { VoteRateLimiter } from '../openbudget/vote-rate-limiter.service';
import { VoteSessionStore } from '../openbudget/vote-session.store';
import { UserService } from '../user/user.service';
import { VoteService } from '../vote/vote.service';
import { VoteFlowService } from './vote-flow.service';

const openBudgetMock = {
  getCaptcha: jest.fn(),
  assertValidPoints: jest.fn(),
  sendCode: jest.fn(),
  verifyOtp: jest.fn(),
  formatPhone: jest.fn((raw: string) => (raw.startsWith('+') ? raw : `+998${raw}`)),
  isValidPhone: jest.fn((raw: string) => /^\+998\d{9}$/.test(raw)),
};

const sessionMock = {
  startCaptcha: jest.fn(),
  attachVote: jest.fn(),
  attachSentCode: jest.fn(),
  get: jest.fn(),
  getConfirmable: jest.fn(),
  consumeOtpAttempt: jest.fn(),
  clear: jest.fn(),
};

const limiterMock = {
  consumeUser: jest.fn(),
  consumePhone: jest.fn(),
  consumeCaptcha: jest.fn(),
  refundUndeliveredSms: jest.fn(),
};

const userMock = {
  findOrCreate: jest.fn(),
  updatePhone: jest.fn(),
};

const voteMock = {
  create: jest.fn(),
  updateStatus: jest.fn(),
  logAction: jest.fn(),
  hasSuccessfulVote: jest.fn(),
};

const CONFIG: Record<string, string | number> = {
  'openbudget.initiativeUuid': 'uuid-1',
  'openbudget.districtId': 55,
};
const configMock = { getOrThrow: jest.fn((key: string) => CONFIG[key]) };

const PROFILE = { firstName: 'Ali', lastName: null, username: 'ali' };
const POINTS = [{ x: 10, y: 20 }];
const REF = { voteId: 7, userId: 3 };

describe('VoteFlowService', () => {
  let flow: VoteFlowService;

  beforeEach(async () => {
    // resetAllMocks — clearAllMocks implementatsiyalarni saqlab qolardi va
    // bir testdagi `mockRejectedValue` keyingilariga oqib ketardi.
    jest.resetAllMocks();

    configMock.getOrThrow.mockImplementation((key: string) => CONFIG[key]);
    openBudgetMock.formatPhone.mockImplementation((raw: string) =>
      raw.startsWith('+') ? raw : `+998${raw}`,
    );
    openBudgetMock.isValidPhone.mockImplementation((raw: string) => /^\+998\d{9}$/.test(raw));

    sessionMock.get.mockResolvedValue({ imageA: 'A', imageB: 'B', cookie: 'S=1', otpAttempts: 0 });
    sessionMock.consumeOtpAttempt.mockResolvedValue(undefined);
    sessionMock.attachSentCode.mockResolvedValue(undefined);
    sessionMock.attachVote.mockResolvedValue(undefined);
    sessionMock.clear.mockResolvedValue(undefined);

    limiterMock.consumeUser.mockResolvedValue(undefined);
    limiterMock.consumeCaptcha.mockResolvedValue(undefined);
    limiterMock.consumePhone.mockResolvedValue(undefined);
    limiterMock.refundUndeliveredSms.mockResolvedValue(undefined);

    voteMock.hasSuccessfulVote.mockResolvedValue(false);
    voteMock.create.mockResolvedValue({ id: 7 });
    voteMock.updateStatus.mockResolvedValue({ id: 7 });
    voteMock.logAction.mockResolvedValue({});

    userMock.findOrCreate.mockResolvedValue({ id: 3 });
    userMock.updatePhone.mockResolvedValue({ id: 3 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        VoteFlowService,
        { provide: OpenBudgetService, useValue: openBudgetMock },
        { provide: VoteSessionStore, useValue: sessionMock },
        { provide: VoteRateLimiter, useValue: limiterMock },
        { provide: UserService, useValue: userMock },
        { provide: VoteService, useValue: voteMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    flow = moduleRef.get(VoteFlowService);
  });

  describe('prepareCaptcha', () => {
    it('captcha va rasmlarni sessiyaga yozadi', async () => {
      const captcha = { imageA: 'A', imageB: 'B', cookie: 'S=1' };
      openBudgetMock.getCaptcha.mockResolvedValue(captcha);

      await expect(flow.prepareCaptcha(111)).resolves.toEqual({ ok: true, value: null });
      expect(sessionMock.startCaptcha).toHaveBeenCalledWith(111, captcha);
    });

    it("captcha limiti tugasa so'rov yubormaydi", async () => {
      limiterMock.consumeCaptcha.mockRejectedValue(new CaptchaQuotaExceededError(3600));

      await expect(flow.prepareCaptcha(111)).resolves.toEqual({
        ok: false,
        failure: { code: 'CAPTCHA_QUOTA_EXCEEDED', retryAfterSeconds: 3600 },
      });
      expect(openBudgetMock.getCaptcha).not.toHaveBeenCalled();
    });
  });

  describe('sendCode', () => {
    it("muvaffaqiyatli oqim: token sessiyada qoladi, tashqariga faqat ID'lar chiqadi", async () => {
      openBudgetMock.sendCode.mockResolvedValue({ cookie: 'SESSION=NEW' });

      const result = await flow.sendCode(111, PROFILE, '901234567', 'contact', POINTS);

      // gr_token qaytarilmasligi SHART — u conversation replay log'iga tushardi.
      expect(result).toEqual({ ok: true, value: { voteId: 7, userId: 3 } });
      expect(sessionMock.attachVote).toHaveBeenCalledWith(111, 7);
      expect(limiterMock.consumeUser).toHaveBeenCalledWith(111, 'contact');
      expect(sessionMock.attachSentCode).toHaveBeenCalledWith(111, '+998901234567', 'SESSION=NEW');
      expect(voteMock.updateStatus).toHaveBeenCalledWith(7, VoteStatus.CODE_SENT);
    });

    it("captcha sessiyasi yo'q bo'lsa to'xtaydi", async () => {
      sessionMock.get.mockResolvedValue(null);

      expect(
        (await flow.sendCode(111, PROFILE, '901234567', 'contact', POINTS)) as {
          failure?: { code: string };
        },
      ).toMatchObject({
        ok: false,
        failure: { code: 'SESSION_EXPIRED' },
      });
      expect(openBudgetMock.sendCode).not.toHaveBeenCalled();
    });

    it('yaroqsiz raqamda limit sarflamaydi', async () => {
      expect(
        (await flow.sendCode(111, PROFILE, '12345', 'contact', POINTS)) as {
          failure?: { code: string };
        },
      ).toMatchObject({
        ok: false,
        failure: { code: 'INVALID_PHONE' },
      });
      expect(limiterMock.consumePhone).not.toHaveBeenCalled();
    });

    it('allaqachon ovoz bergan raqamda limit sarflamaydi', async () => {
      voteMock.hasSuccessfulVote.mockResolvedValue(true);

      expect(
        (await flow.sendCode(111, PROFILE, '901234567', 'contact', POINTS)) as {
          failure?: { code: string };
        },
      ).toMatchObject({
        ok: false,
        failure: { code: 'DUPLICATE_VOTE' },
      });
      expect(limiterMock.consumePhone).not.toHaveBeenCalled();
      expect(openBudgetMock.sendCode).not.toHaveBeenCalled();
    });

    it("limit tugagan bo'lsa SMS yubormaydi", async () => {
      limiterMock.consumePhone.mockRejectedValue(new PhoneRateLimitedError(3600));

      expect(
        (await flow.sendCode(111, PROFILE, '901234567', 'contact', POINTS)) as {
          failure?: { code: string };
        },
      ).toMatchObject({
        ok: false,
        failure: { code: 'PHONE_RATE_LIMITED' },
      });
      expect(openBudgetMock.sendCode).not.toHaveBeenCalled();
    });

    it("so'rov serverga yetmagan bo'lsa limitni qaytaradi", async () => {
      openBudgetMock.sendCode.mockRejectedValue(new OpenBudgetUnavailableError('ECONNREFUSED'));

      expect(
        (await flow.sendCode(111, PROFILE, '901234567', 'contact', POINTS)) as {
          failure?: { code: string };
        },
      ).toMatchObject({
        ok: false,
        failure: { code: 'SERVICE_UNAVAILABLE' },
      });
      expect(limiterMock.refundUndeliveredSms).toHaveBeenCalledWith('+998901234567');
      expect(voteMock.updateStatus).toHaveBeenCalledWith(7, VoteStatus.FAILED, expect.any(String));
    });

    it("SMS ketgan bo'lishi mumkin bo'lsa limitni QAYTARMAYDI", async () => {
      // ECONNRESET so'rov qayta ishlangandan keyin ham keladi.
      openBudgetMock.sendCode.mockRejectedValue(new OpenBudgetUnavailableError('ECONNRESET'));

      expect(
        (await flow.sendCode(111, PROFILE, '901234567', 'contact', POINTS)) as {
          failure?: { code: string };
        },
      ).toMatchObject({
        ok: false,
        failure: { code: 'SERVICE_UNAVAILABLE' },
      });
      expect(limiterMock.refundUndeliveredSms).not.toHaveBeenCalled();
    });
  });

  describe('confirmOtp', () => {
    it('kodni tasdiqlaydi va sessiyani tozalaydi', async () => {
      sessionMock.getConfirmable.mockResolvedValue({
        imageA: 'A',
        imageB: 'B',
        cookie: 'SESSION=SECRET',
        phone: '+998901234567',
        otpAttempts: 0,
      });
      openBudgetMock.verifyOtp.mockResolvedValue({ message: 'Qabul qilindi' });

      await expect(flow.confirmOtp(111, REF, '123456')).resolves.toEqual({ ok: true, value: null });

      expect(sessionMock.consumeOtpAttempt).toHaveBeenCalledWith(111);
      expect(openBudgetMock.verifyOtp).toHaveBeenCalledWith('123456', 'SESSION=SECRET');
      expect(voteMock.updateStatus).toHaveBeenCalledWith(7, VoteStatus.SUCCESS);
      expect(sessionMock.clear).toHaveBeenCalledWith(111);
    });

    it('urinishni tekshiruvdan OLDIN hisoblaydi', async () => {
      sessionMock.consumeOtpAttempt.mockRejectedValue(new OtpAttemptsExhaustedError());

      await expect(flow.confirmOtp(111, REF, '123456')).resolves.toEqual({
        ok: false,
        failure: { code: 'OTP_ATTEMPTS_EXHAUSTED' },
      });
      expect(openBudgetMock.verifyOtp).not.toHaveBeenCalled();
    });

    it("sessiya to'liq bo'lmasa to'xtaydi", async () => {
      sessionMock.getConfirmable.mockResolvedValue(null);

      expect(
        (await flow.confirmOtp(111, REF, '123456')) as { failure?: { code: string } },
      ).toMatchObject({
        ok: false,
        failure: { code: 'SESSION_EXPIRED' },
      });
    });
  });

  describe('cancel', () => {
    it('sessiyadagi ovozni topib yopadi', async () => {
      // voteId sessiyadan olinadi: timeout'da chaqiruvchida u bo'lmaydi.
      sessionMock.get.mockResolvedValue({ imageA: 'A', imageB: 'B', otpAttempts: 0, voteId: 7 });

      await flow.cancel(111);

      expect(sessionMock.clear).toHaveBeenCalledWith(111);
      expect(voteMock.updateStatus).toHaveBeenCalledWith(7, VoteStatus.FAILED, 'CANCELLED');
    });

    it('sababni uzatadi', async () => {
      sessionMock.get.mockResolvedValue({ imageA: 'A', imageB: 'B', otpAttempts: 0, voteId: 7 });

      await flow.cancel(111, 'TIMEOUT');

      expect(voteMock.updateStatus).toHaveBeenCalledWith(7, VoteStatus.FAILED, 'TIMEOUT');
    });

    it("ovoz holatini yopib bo'lmasa ham yiqilmaydi", async () => {
      sessionMock.get.mockResolvedValue({ imageA: 'A', imageB: 'B', otpAttempts: 0, voteId: 7 });
      voteMock.updateStatus.mockRejectedValue(new Error('DB uzildi'));

      await expect(flow.cancel(111)).resolves.toBeUndefined();
    });

    it("sessiyada ovoz bo'lmasa faqat tozalaydi", async () => {
      sessionMock.get.mockResolvedValue({
        imageA: 'A',
        imageB: 'B',
        cookie: 'S=1',
        otpAttempts: 0,
      });

      await flow.cancel(111);

      expect(sessionMock.clear).toHaveBeenCalledWith(111);
      expect(voteMock.updateStatus).not.toHaveBeenCalled();
    });
  });
  describe("telefon manbasi bo'yicha limit", () => {
    it("qo'lda kiritilgan raqam uchun 'manual' uzatiladi", async () => {
      openBudgetMock.sendCode.mockResolvedValue({ cookie: 'SESSION=NEW' });

      await flow.sendCode(111, PROFILE, '901234567', 'manual', POINTS);

      expect(limiterMock.consumeUser).toHaveBeenCalledWith(111, 'manual');
    });

    it("qo'lda kiritish limiti tugasa SMS yubormaydi", async () => {
      limiterMock.consumeUser.mockRejectedValue(new ManualPhoneQuotaExceededError(3600));

      await expect(flow.sendCode(111, PROFILE, '901234567', 'manual', POINTS)).resolves.toEqual({
        ok: false,
        failure: { code: 'MANUAL_QUOTA_EXCEEDED', retryAfterSeconds: 3600 },
      });
      expect(openBudgetMock.sendCode).not.toHaveBeenCalled();
    });
  });
});
