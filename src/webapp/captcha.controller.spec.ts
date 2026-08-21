import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottleService } from '../common/throttle/throttle.service';
import { VoteSessionStore } from '../openbudget/vote-session.store';
import { CaptchaController } from './captcha.controller';

const BOT_TOKEN = '123456:TEST-TOKEN';

const sessionMock = { get: jest.fn() };
const throttleMock = { isExceeded: jest.fn() };
const configMock = { getOrThrow: jest.fn().mockReturnValue(BOT_TOKEN) };

/** Haqiqiy Telegram imzosi bilan initData yasaydi. */
function signInitData(userId: number): string {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Ali' }),
  };
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const SESSION = {
  cookie: 'JSESSIONID=SECRET-KEY',
  imageA: 'AAA',
  imageB: 'BBB',
  otpAttempts: 0,
};

describe('CaptchaController', () => {
  let controller: CaptchaController;

  beforeEach(async () => {
    jest.clearAllMocks();
    configMock.getOrThrow.mockReturnValue(BOT_TOKEN);
    throttleMock.isExceeded.mockResolvedValue(false);

    const moduleRef = await Test.createTestingModule({
      controllers: [CaptchaController],
      providers: [
        { provide: VoteSessionStore, useValue: sessionMock },
        { provide: ConfigService, useValue: configMock },
        { provide: ThrottleService, useValue: throttleMock },
      ],
    }).compile();
    controller = moduleRef.get(CaptchaController);
  });

  it('tasdiqlangan foydalanuvchiga rasmlarni beradi', async () => {
    sessionMock.get.mockResolvedValue(SESSION);

    const result = await controller.getCaptcha(signInitData(555));

    expect(result).toEqual({ imageA: 'AAA', imageB: 'BBB' });
    // Sessiya aynan initData dagi foydalanuvchi bo'yicha olinadi (IDOR yo'q).
    expect(sessionMock.get).toHaveBeenCalledWith(555);
  });

  it('maxfiy captchaKey ni javobda YUBORMAYDI', async () => {
    sessionMock.get.mockResolvedValue(SESSION);

    const result = await controller.getCaptcha(signInitData(555));

    expect(JSON.stringify(result)).not.toContain('SECRET-KEY');
  });

  const INVALID_INIT_DATA: Array<{ label: string; value: string | undefined }> = [
    { label: "sarlavha yo'q", value: undefined },
    { label: "bo'sh satr", value: '' },
    { label: 'imzo xato', value: `user=%7B%22id%22%3A555%7D&hash=${'0'.repeat(64)}` },
  ];

  it.each(INVALID_INIT_DATA)(
    'tasdiqlanmagan initData ni 401 bilan rad etadi ($label)',
    async ({ value }) => {
      await expect(controller.getCaptcha(value)).rejects.toBeInstanceOf(HttpException);
      expect(sessionMock.get).not.toHaveBeenCalled();
    },
  );

  it('401 javobida sabab oshkor qilinmaydi', async () => {
    const error = await controller.getCaptcha('buzilgan').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(401);
    expect((error as HttpException).getResponse()).toEqual({ error: 'UNAUTHORIZED' });
  });

  it("sessiya yo'q bo'lsa 404 SESSION_NOT_FOUND", async () => {
    sessionMock.get.mockResolvedValue(null);

    const error = await controller.getCaptcha(signInitData(555)).catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toEqual({ error: 'SESSION_NOT_FOUND' });
  });

  it("boshqa bot tokeni bilan imzolangan so'rovni rad etadi", async () => {
    configMock.getOrThrow.mockReturnValue('999:BOSHQA');

    await expect(controller.getCaptcha(signInitData(555))).rejects.toBeInstanceOf(HttpException);
  });
  describe('himoya chegaralari', () => {
    it('chegara oshsa 429 qaytaradi va sessiyaga tegmaydi', async () => {
      throttleMock.isExceeded.mockResolvedValue(true);

      const error = await controller.getCaptcha(signInitData(555)).catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(429);
      expect(sessionMock.get).not.toHaveBeenCalled();
    });

    it("tasdiqlanmagan so'rov chegara hisoblagichini sarflamaydi", async () => {
      await controller.getCaptcha('buzilgan').catch(() => undefined);

      expect(throttleMock.isExceeded).not.toHaveBeenCalled();
    });

    it('juda katta rasmni bermaydi', async () => {
      sessionMock.get.mockResolvedValue({
        ...SESSION,
        imageA: 'x'.repeat(600 * 1024),
      });

      const error = await controller.getCaptcha(signInitData(555)).catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(502);
    });
  });
});
