import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { InvalidPhoneError } from '../vote/vote.errors';
import { OPENBUDGET_ENDPOINTS } from './openbudget.endpoints';
import {
  CaptchaRejectedError,
  InvalidCaptchaPointsError,
  InvalidOtpError,
  InvalidOtpFormatError,
  OpenBudgetApiError,
  OpenBudgetUnavailableError,
} from './openbudget.errors';
import { OpenBudgetService } from './openbudget.service';

jest.mock('axios');

const requestMock = jest.fn();
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CONFIG: Record<string, string | number> = {
  'openbudget.baseUrl': 'https://new.openbudget.uz',
  'openbudget.initiativeUrl': 'https://new.openbudget.uz/uz/initiative-budget',
  'openbudget.initiativeUuid': 'uuid-1',
  'openbudget.districtId': 55,
};
const configMock = { getOrThrow: jest.fn((key: string) => CONFIG[key]) };

/** Saytdagi captcha sahifasining soddalashtirilgan nusxasi. */
const captchaHtml = (): string => `
<form id="vote-form" action="/api/v2/vote/mvc/captcha" method="post">
  <div class="error-alert hide-element" id="error-alert"></div>
  <div class="form-item">
    <div class="refresh-block">
      <div class="label">Расм <b>A</b></div>
      <img height="40px" src="data:image/png;base64,AAAA" alt="">
      <button type="button" id="refresh"></button>
    </div>
  </div>
  <img id="imageB" loading="lazy" src="data:image/jpeg;base64,BBBB" alt="">
  <input required type="text" id="points" hidden="hidden" name="points">
</form>`;

/** SMS kod sahifasi (POST /captcha muvaffaqiyatli bo'lganda). */
const otpHtml = (error = ''): string => `
<form id="vote-form" action="/api/v2/vote/mvc/verify" method="post">
  <div class="error-alert" id="error-alert">${error}</div>
  <input type="text" id="confirm-code" name="otpCode" value="">
  <input type="hidden" name="grToken"/>
</form>`;

const captchaErrorHtml = (error: string): string =>
  captchaHtml().replace('id="error-alert"></div>', `id="error-alert">${error}</div>`);

const reply = (status: number, data: string, setCookie?: string[]) => ({
  status,
  data,
  headers: setCookie === undefined ? {} : { 'set-cookie': setCookie },
});

const networkError = (code: string): AxiosError => {
  const error = new AxiosError('tarmoq xatosi');
  error.code = code;
  return error;
};

/** Oxirgi `http.request` chaqiruvining argumentini tiplab qaytaradi. */
function lastCall<T>(): T {
  const calls = requestMock.mock.calls as unknown[][];
  return calls[calls.length - 1][0] as T;
}

const POINTS = [
  { x: 10, y: 20 },
  { x: 30, y: 40 },
];

describe('OpenBudgetService', () => {
  let service: OpenBudgetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedAxios.create.mockReturnValue({ request: requestMock } as unknown as AxiosInstance);

    const moduleRef = await Test.createTestingModule({
      providers: [OpenBudgetService, { provide: ConfigService, useValue: configMock }],
    }).compile();
    service = moduleRef.get(OpenBudgetService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const FAILED = Symbol('failed');
  const runWithTimers = async <T>(promise: Promise<T>): Promise<T> => {
    const settled = promise.then(
      (value) => ({ [FAILED]: false, value }) as const,
      (error: unknown) => ({ [FAILED]: true, error }) as const,
    );
    await jest.runAllTimersAsync();
    const result = await settled;
    if (result[FAILED]) {
      throw (result as { error: unknown }).error;
    }
    return (result as { value: T }).value;
  };

  describe('getCaptcha', () => {
    it('HTML dan ikkala rasmni ajratadi', async () => {
      requestMock.mockResolvedValue(reply(200, captchaHtml()));

      await expect(runWithTimers(service.getCaptcha())).resolves.toEqual({
        imageA: 'data:image/png;base64,AAAA',
        imageB: 'data:image/jpeg;base64,BBBB',
      });
    });

    it("URL ga tashabbus UUID sini qo'yadi", async () => {
      requestMock.mockResolvedValue(reply(200, captchaHtml()));

      await runWithTimers(service.getCaptcha());

      expect(requestMock).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', url: '/api/v2/vote/mvc/captcha/uuid-1' }),
      );
    });

    it('sessiya cookie sini saqlaydi', async () => {
      requestMock.mockResolvedValue(
        reply(200, captchaHtml(), ['JSESSIONID=abc123; Path=/; HttpOnly', 'other=1; Path=/']),
      );

      const result = await runWithTimers(service.getCaptcha());

      // Sayt formada kalit uzatmaydi — sessiya faqat cookie orqali yuriydi.
      expect(result.cookie).toBe('JSESSIONID=abc123; other=1');
    });

    it("HTML kutilgan formatda emas bo'lsa xatolik beradi", async () => {
      requestMock.mockResolvedValue(reply(200, '<html><body>xato</body></html>'));

      await expect(runWithTimers(service.getCaptcha())).rejects.toBeInstanceOf(OpenBudgetApiError);
    });

    it("timeout da qayta urinadi (GET yon ta'sirsiz)", async () => {
      requestMock
        .mockRejectedValueOnce(networkError('ECONNABORTED'))
        .mockResolvedValueOnce(reply(200, captchaHtml()));

      await expect(runWithTimers(service.getCaptcha())).resolves.toMatchObject({
        imageA: expect.stringContaining('AAAA') as string,
      });
      expect(requestMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendCode', () => {
    it('form-urlencoded yuboradi va telefonni +998 siz beradi', async () => {
      requestMock.mockResolvedValue(reply(200, otpHtml()));

      await runWithTimers(service.sendCode('+998901234567', POINTS, 'JSESSIONID=abc'));

      const call = lastCall<{ url: string; data: string; headers: Record<string, string> }>();
      expect(call.url).toBe(OPENBUDGET_ENDPOINTS.submitCaptcha.path);
      expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(call.headers.Cookie).toBe('JSESSIONID=abc');

      const body = new URLSearchParams(call.data);
      // Saytdagi maydon `+998` siz, faqat 9 xonali qismni kutadi.
      expect(body.get('phoneNumber')).toBe('901234567');
      expect(JSON.parse(body.get('points') ?? '')).toEqual(POINTS);
    });

    it('captcha sahifasi qaytsa CaptchaRejectedError beradi', async () => {
      requestMock.mockResolvedValue(reply(200, captchaErrorHtml('Расм нотўғри')));

      await expect(runWithTimers(service.sendCode('+998901234567', POINTS))).rejects.toBeInstanceOf(
        CaptchaRejectedError,
      );
    });

    it.each([503, 502, 500, 429])(
      "%s javobida QAYTA URINMAYDI — SMS ketgan bo'lishi mumkin",
      async (status) => {
        requestMock.mockResolvedValue(reply(status, ''));

        await expect(
          runWithTimers(service.sendCode('+998901234567', POINTS)),
        ).rejects.toBeInstanceOf(OpenBudgetApiError);
        expect(requestMock).toHaveBeenCalledTimes(1);
      },
    );

    it('ECONNRESET da QAYTA URINMAYDI', async () => {
      requestMock.mockRejectedValue(networkError('ECONNRESET'));

      await expect(runWithTimers(service.sendCode('+998901234567', POINTS))).rejects.toBeInstanceOf(
        OpenBudgetUnavailableError,
      );
      expect(requestMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyOtp', () => {
    it("otpCode va BO'SH grToken yuboradi", async () => {
      requestMock.mockResolvedValue(reply(200, '<html><body>Rahmat</body></html>'));

      await runWithTimers(service.verifyOtp('123456', 'JSESSIONID=abc'));

      const call = lastCall<{ url: string; data: string }>();
      expect(call.url).toBe(OPENBUDGET_ENDPOINTS.verifyOtp.path);

      const body = new URLSearchParams(call.data);
      expect(body.get('otpCode')).toBe('123456');
      // Saytda reCAPTCHA izohga olingan va forma bu maydonni tozalab yuboradi.
      expect(body.get('grToken')).toBe('');
      // `phone` YUBORILMAYDI — saytdagi maydon `disabled`.
      expect(body.has('phone')).toBe(false);
    });

    it('OTP sahifasi qaytsa kod rad etilgan', async () => {
      requestMock.mockResolvedValue(reply(200, otpHtml('Код нотўғри')));

      await expect(runWithTimers(service.verifyOtp('000000'))).rejects.toBeInstanceOf(
        InvalidOtpError,
      );
    });

    it('HECH QACHON qayta urinmaydi', async () => {
      requestMock.mockResolvedValue(reply(503, ''));

      await expect(runWithTimers(service.verifyOtp('123456'))).rejects.toBeInstanceOf(
        OpenBudgetApiError,
      );
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it.each(['abc', '12', '1234567', ''])('yaroqsiz kod formatini rad etadi (%s)', async (otp) => {
      await expect(runWithTimers(service.verifyOtp(otp))).rejects.toBeInstanceOf(
        InvalidOtpFormatError,
      );
      expect(requestMock).not.toHaveBeenCalled();
    });
  });

  describe('input validatsiyasi', () => {
    it('yaroqsiz telefonni yubormaydi', async () => {
      await expect(runWithTimers(service.sendCode('+998', POINTS))).rejects.toBeInstanceOf(
        InvalidPhoneError,
      );
      expect(requestMock).not.toHaveBeenCalled();
    });

    it.each([
      [[], "bo'sh"],
      [[{ x: 1, y: 1 }], 'bitta nuqta'],
      [
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
        'uchta nuqta',
      ],
      [
        [
          { x: 400, y: 1 },
          { x: 2, y: 2 },
        ],
        'kenglikdan tashqarida',
      ],
      [
        [
          { x: 1, y: 300 },
          { x: 2, y: 2 },
        ],
        'balandlikdan tashqarida',
      ],
      [
        [
          { x: 1.5, y: 1 },
          { x: 2, y: 2 },
        ],
        'butun son emas',
      ],
    ])('yaroqsiz nuqtalarni rad etadi (%#: %s)', async (points) => {
      await expect(
        runWithTimers(service.sendCode('+998901234567', points as never)),
      ).rejects.toBeInstanceOf(InvalidCaptchaPointsError);
      expect(requestMock).not.toHaveBeenCalled();
    });
  });
});
