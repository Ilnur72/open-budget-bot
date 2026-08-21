import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { maskPhone } from '../common/utils/mask-phone.util';
import { formatUzPhone, isValidUzPhone } from '../common/utils/phone.util';
import { InvalidPhoneError } from '../vote/vote.errors';
import { classifyResponse, parseCaptchaPage } from './html-parser';
import {
  CAPTCHA_IMAGE_HEIGHT,
  CAPTCHA_IMAGE_WIDTH,
  OPENBUDGET_ENDPOINTS,
  REQUIRED_CAPTCHA_POINTS,
  type OpenBudgetEndpoint,
} from './openbudget.endpoints';
import {
  CaptchaRejectedError,
  InvalidCaptchaPointsError,
  InvalidOtpError,
  InvalidOtpFormatError,
  OpenBudgetApiError,
  OpenBudgetUnavailableError,
} from './openbudget.errors';
import type {
  CaptchaChallenge,
  CaptchaPoint,
  SendCodeResult,
  VerifyOtpResult,
} from './openbudget.types';

/** Bitta HTTP so'rov uchun timeout. */
const REQUEST_TIMEOUT_MS = 12_000;

/** Bitta mantiqiy chaqiruv (qayta urinishlar bilan) shundan oshmasin. */
const TOTAL_BUDGET_MS = 45_000;

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/** Captcha HTML'i base64 rasmlar bilan keladi — javob katta bo'lishi mumkin. */
const MAX_CONTENT_LENGTH_BYTES = 8 * 1024 * 1024;
const MAX_BODY_LENGTH_BYTES = 256 * 1024;

/**
 * So'rov serverga UMUMAN yetib bormaganini bildiruvchi kodlar.
 * `ECONNRESET` bu ro'yxatda YO'Q: u so'rov qayta ishlangandan keyin ham keladi.
 */
const PRE_SEND_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

const IDEMPOTENT_RETRY_CODES = new Set([
  ...PRE_SEND_ERROR_CODES,
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** SMS kod formati (saytdagi `\d{0,6}` cheklovi). */
const OTP_PATTERN = /^\d{4,6}$/;

interface RequestOptions {
  idempotent: boolean;
  maxAttempts?: number;
  logContext?: string;
  cookie?: string;
}

interface HtmlResponse {
  html: string;
  cookie?: string;
}

/**
 * openbudget.uz bilan ishlaydigan servis.
 *
 * DIQQAT: bu JSON API emas. Sayt server tomonda render qilingan HTML formalar
 * bilan ishlaydi (`/api/v2/vote/mvc/...`), sessiyani esa cookie orqali yuritadi —
 * formada hech qanday yashirin kalit uzatilmaydi.
 */
@Injectable()
export class OpenBudgetService {
  private readonly logger = new Logger(OpenBudgetService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.http = axios.create({
      baseURL: this.configService.getOrThrow<string>('openbudget.baseUrl'),
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_CONTENT_LENGTH_BYTES,
      maxBodyLength: MAX_BODY_LENGTH_BYTES,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'uz,ru;q=0.9',
        Referer: this.configService.getOrThrow<string>('openbudget.initiativeUrl'),
      },
      validateStatus: () => true,
    });
  }

  /** Telefon raqamni `+998XXXXXXXXX` ko'rinishiga keltiradi. */
  formatPhone(raw: string): string {
    return formatUzPhone(raw);
  }

  /** Raqam O'zbekiston mobil raqami formatiga mos kelishini tekshiradi. */
  isValidPhone(raw: string): boolean {
    return isValidUzPhone(raw);
  }

  /** Captcha nuqtalarini tekshiradi (kvota sarflanishidan oldin chaqiriladi). */
  assertValidPoints(points: CaptchaPoint[]): void {
    assertValidPoints(points);
  }

  /**
   * 1-bosqich: captcha sahifasini olish.
   * GET va yon ta'sirsiz — to'liq qayta urinish qo'llanadi.
   */
  async getCaptcha(): Promise<CaptchaChallenge> {
    const uuid = this.configService.getOrThrow<string>('openbudget.initiativeUuid');
    const endpoint = {
      ...OPENBUDGET_ENDPOINTS.captcha,
      path: OPENBUDGET_ENDPOINTS.captcha.path.replace('{uuid}', encodeURIComponent(uuid)),
    };

    const { html, cookie } = await this.request(endpoint, { method: 'GET' }, { idempotent: true });

    const parsed = parseCaptchaPage(html);
    if (parsed === null) {
      throw new OpenBudgetApiError('Captcha sahifasi kutilgan formatda emas');
    }

    return { ...parsed, ...(cookie === undefined ? {} : { cookie }) };
  }

  /**
   * 2-bosqich: telefon va captcha yechimini yuborish. SMS shu yerda ketadi.
   *
   * Yon ta'sirli: 5xx/timeout holatlarida QAYTA URINILMAYDI — aks holda bitta
   * amaldan foydalanuvchiga bir nechta SMS ketardi.
   */
  async sendCode(phone: string, points: CaptchaPoint[], cookie?: string): Promise<SendCodeResult> {
    const normalized = formatUzPhone(phone);
    if (!isValidUzPhone(normalized)) {
      throw new InvalidPhoneError(maskPhone(phone));
    }
    assertValidPoints(points);

    const response = await this.request(
      OPENBUDGET_ENDPOINTS.submitCaptcha,
      {
        method: 'POST',
        // Sayt oddiy HTML forma yuboradi, JSON emas.
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          // Saytdagi maydon `+998` siz, faqat 9 xonali qismni kutadi.
          phoneNumber: toLocalPhone(normalized),
          points: JSON.stringify(points),
        }).toString(),
      },
      { idempotent: false, cookie, logContext: `phone=${maskPhone(normalized)}` },
    );

    const page = classifyResponse(response.html);
    if (page.kind === 'captcha') {
      // Captcha sahifasi qaytdi — yechim qabul qilinmadi.
      throw new CaptchaRejectedError(page.error);
    }
    if (page.kind !== 'otp') {
      const detail = 'error' in page ? page.error : undefined;
      throw new OpenBudgetApiError('Kutilmagan javob sahifasi', undefined, detail);
    }

    return response.cookie === undefined ? {} : { cookie: response.cookie };
  }

  /**
   * 3-bosqich: SMS kodni tasdiqlash va ovozni yakunlash.
   *
   * Qayta urinish yo'q — har bir urinish sayt tomonda hisoblanadi.
   * `grToken` ATAYLAB bo'sh: saytda reCAPTCHA kodi izohga olingan va forma
   * bu maydonni yuborishdan oldin tozalaydi.
   */
  async verifyOtp(otpCode: string, cookie?: string): Promise<VerifyOtpResult> {
    if (!OTP_PATTERN.test(otpCode)) {
      throw new InvalidOtpFormatError();
    }

    const response = await this.request(
      OPENBUDGET_ENDPOINTS.verifyOtp,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // `phone` yuborilmaydi — saytdagi maydon `disabled`, server uni
        // sessiyadan biladi.
        data: new URLSearchParams({ otpCode, grToken: '' }).toString(),
      },
      { idempotent: false, maxAttempts: 1, cookie },
    );

    const page = classifyResponse(response.html);
    if (page.kind === 'otp') {
      // OTP sahifasi qaytdi — kod qabul qilinmadi.
      throw new InvalidOtpError(page.error);
    }
    if (page.kind === 'captcha') {
      throw new CaptchaRejectedError(page.error);
    }

    return { message: 'Ovoz muvaffaqiyatli berildi' };
  }

  /** So'rovni yuboradi, qayta urinishlarni boshqaradi va xatolikni tasniflaydi. */
  private async request(
    endpoint: OpenBudgetEndpoint,
    config: AxiosRequestConfig,
    options: RequestOptions,
  ): Promise<HtmlResponse> {
    const maxAttempts = options.maxAttempts ?? MAX_RETRY_ATTEMPTS;
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const label = `${config.method ?? 'GET'} ${endpoint.path}`;
    const context = options.logContext ? ` ${options.logContext}` : '';

    for (let attempt = 1; ; attempt++) {
      const isLastAttempt = attempt >= maxAttempts;
      const startedAt = Date.now();
      const outcome = await this.attempt(
        endpoint,
        config,
        options,
        label,
        context,
        startedAt,
        attempt,
        maxAttempts,
      );

      if (outcome.kind === 'ok') {
        return outcome.response;
      }

      const canRetry =
        !isLastAttempt &&
        this.isRetryable(outcome, options.idempotent) &&
        Date.now() + this.backoff(attempt) < deadline;

      if (!canRetry) {
        throw outcome.error;
      }
      await delay(this.backoff(attempt));
    }
  }

  private async attempt(
    endpoint: OpenBudgetEndpoint,
    config: AxiosRequestConfig,
    options: RequestOptions,
    label: string,
    context: string,
    startedAt: number,
    attempt: number,
    maxAttempts: number,
  ): Promise<Outcome> {
    try {
      const response = await this.http.request<string>({
        ...config,
        url: endpoint.path,
        responseType: 'text',
        ...(endpoint.baseUrl === null ? {} : { baseURL: endpoint.baseUrl }),
        headers: {
          ...config.headers,
          ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
        },
      });

      const duration = Date.now() - startedAt;
      this.logger.log(`${label} -> ${response.status} (${duration}ms)${context}`);

      if (response.status >= 200 && response.status < 300) {
        const cookie = extractCookie(response.headers['set-cookie']);
        return {
          kind: 'ok',
          response: { html: response.data, ...(cookie === undefined ? {} : { cookie }) },
        };
      }

      return {
        kind: 'status',
        status: response.status,
        error: new OpenBudgetApiError(`openbudget.uz ${response.status} qaytardi`, response.status),
      };
    } catch (error) {
      if (!(error instanceof AxiosError)) {
        throw new OpenBudgetApiError(`Kutilmagan xatolik: ${String(error)}`);
      }

      if (error.response) {
        return {
          kind: 'status',
          status: error.response.status,
          error: new OpenBudgetApiError(
            `openbudget.uz ${error.response.status} qaytardi`,
            error.response.status,
          ),
        };
      }

      const duration = Date.now() - startedAt;
      this.logger.warn(
        `${label} -> ${error.code ?? 'XATO'} (${duration}ms), urinish ${attempt}/${maxAttempts}`,
      );

      return {
        kind: 'network',
        code: error.code,
        error: new OpenBudgetUnavailableError(error.code ?? error.message),
      };
    }
  }

  private isRetryable(outcome: Outcome, idempotent: boolean): boolean {
    if (outcome.kind === 'status') {
      return idempotent && RETRYABLE_STATUS_CODES.has(outcome.status);
    }
    if (outcome.kind === 'network') {
      const codes = idempotent ? IDEMPOTENT_RETRY_CODES : PRE_SEND_ERROR_CODES;
      return outcome.code !== undefined && codes.has(outcome.code);
    }
    return false;
  }

  private backoff(attempt: number): number {
    return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  }
}

type Outcome =
  | { kind: 'ok'; response: HtmlResponse }
  | { kind: 'status'; status: number; code?: undefined; error: Error }
  | { kind: 'network'; code?: string; status?: undefined; error: Error };

/** `+998901234567` -> `901234567` (saytdagi maydon prefikssiz). */
function toLocalPhone(normalized: string): string {
  return normalized.replace(/^\+998/, '');
}

/** `Set-Cookie` sarlavhasidan `name=value` juftliklarini yig'adi. */
function extractCookie(setCookie: unknown): string | undefined {
  if (!Array.isArray(setCookie) || setCookie.length === 0) {
    return undefined;
  }
  const pairs = setCookie
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.split(';')[0])
    .filter((pair) => pair.includes('='));

  return pairs.length > 0 ? pairs.join('; ') : undefined;
}

/**
 * Captcha nuqtalarini tekshiradi.
 * Sayt AYNAN 2 ta nuqta kutadi va koordinatalar rasm B fazosida bo'lishi kerak.
 */
function assertValidPoints(points: CaptchaPoint[]): void {
  if (!Array.isArray(points) || points.length !== REQUIRED_CAPTCHA_POINTS) {
    throw new InvalidCaptchaPointsError(`aynan ${REQUIRED_CAPTCHA_POINTS} ta nuqta kerak`);
  }
  for (const point of points) {
    const valid =
      Number.isInteger(point?.x) &&
      Number.isInteger(point?.y) &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < CAPTCHA_IMAGE_WIDTH &&
      point.y < CAPTCHA_IMAGE_HEIGHT;
    if (!valid) {
      throw new InvalidCaptchaPointsError('koordinata rasm chegarasidan tashqarida');
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
