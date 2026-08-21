import { VoteStatus } from '@prisma/client';
import {
  CaptchaRejectedError,
  InvalidOtpError,
  OpenBudgetApiError,
  OpenBudgetUnavailableError,
  OtpAttemptsExhaustedError,
  PhoneRateLimitedError,
  UserQuotaExceededError,
  VoteSessionExpiredError,
} from '../openbudget/openbudget.errors';
import { DuplicateVoteError, InvalidPhoneError } from '../vote/vote.errors';
import { classifyError, formatVoteStatus, formatWait, toUserMessage } from './bot.messages';
import type { FlowErrorCode } from './flow-result';

describe('classifyError', () => {
  it.each([
    [new InvalidPhoneError('+998***567'), 'INVALID_PHONE'],
    [new DuplicateVoteError('uuid'), 'DUPLICATE_VOTE'],
    [new OtpAttemptsExhaustedError(), 'OTP_ATTEMPTS_EXHAUSTED'],
    [new InvalidOtpError(), 'INVALID_OTP'],
    [new CaptchaRejectedError(), 'CAPTCHA_REJECTED'],
    [new VoteSessionExpiredError(), 'SESSION_EXPIRED'],
    [new OpenBudgetUnavailableError('ECONNRESET'), 'SERVICE_UNAVAILABLE'],
    [new OpenBudgetApiError('500'), 'API_ERROR'],
    [new Error('boshqa'), 'UNKNOWN'],
    ['satr', 'UNKNOWN'],
  ])('%s -> %s', (error, expected) => {
    expect(classifyError(error).code).toBe(expected);
  });

  it('kutish vaqtini limitdan oladi', () => {
    expect(classifyError(new PhoneRateLimitedError(1800))).toEqual({
      code: 'PHONE_RATE_LIMITED',
      retryAfterSeconds: 1800,
    });
    expect(classifyError(new UserQuotaExceededError(60))).toEqual({
      code: 'USER_QUOTA_EXCEEDED',
      retryAfterSeconds: 60,
    });
  });
});

describe('toUserMessage', () => {
  const ALL_CODES: FlowErrorCode[] = [
    'INVALID_PHONE',
    'DUPLICATE_VOTE',
    'PHONE_RATE_LIMITED',
    'USER_QUOTA_EXCEEDED',
    'CAPTCHA_QUOTA_EXCEEDED',
    'OTP_ATTEMPTS_EXHAUSTED',
    'INVALID_OTP_FORMAT',
    'INVALID_OTP',
    'CAPTCHA_REJECTED',
    'SESSION_EXPIRED',
    'SERVICE_UNAVAILABLE',
    'SERVICE_DEGRADED',
    'API_ERROR',
    'UNKNOWN',
  ];

  it.each(ALL_CODES)('%s uchun matn bor va NaN chiqmaydi', (code) => {
    const text = toUserMessage({ code });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
  });

  it("kutish vaqtini matnga qo'shadi", () => {
    expect(toUserMessage({ code: 'PHONE_RATE_LIMITED', retryAfterSeconds: 7200 })).toContain(
      '2 soatdan',
    );
  });
});

describe('formatWait', () => {
  it.each([
    [7200, '2 soatdan'],
    [3600, '1 soatdan'],
    [1800, '30 daqiqadan'],
    [61, '2 daqiqadan'],
    [1, '1 daqiqadan'],
    [0, '1 daqiqadan'],
    [undefined, '1 daqiqadan'],
  ])('%s -> %s', (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected);
  });
});

describe('formatVoteStatus', () => {
  it('barcha holatlar uchun matn beradi', () => {
    for (const status of Object.values(VoteStatus)) {
      expect(formatVoteStatus(status).length).toBeGreaterThan(0);
    }
  });
});
