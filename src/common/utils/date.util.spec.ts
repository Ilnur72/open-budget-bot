import { startOfDayInTimeZone } from './date.util';

describe('startOfDayInTimeZone', () => {
  describe("Asia/Tashkent (UTC+5, DST yo'q)", () => {
    it("ertalabki UTC vaqtdan to'g'ri kun boshini beradi", () => {
      // Tashkentda 07:00, 21-avgust -> kun boshi 20-avgust 19:00 UTC
      expect(
        startOfDayInTimeZone('Asia/Tashkent', new Date('2026-08-21T02:00:00Z')).toISOString(),
      ).toBe('2026-08-20T19:00:00.000Z');
    });

    it('UTC kuni almashsa ham Tashkent kuni saqlanadi', () => {
      // Tashkentda 00:30, 22-avgust -> kun boshi 21-avgust 19:00 UTC
      expect(
        startOfDayInTimeZone('Asia/Tashkent', new Date('2026-08-21T19:30:00Z')).toISOString(),
      ).toBe('2026-08-21T19:00:00.000Z');
    });

    it("aynan kun boshida o'zini qaytaradi", () => {
      expect(
        startOfDayInTimeZone('Asia/Tashkent', new Date('2026-08-21T19:00:00Z')).toISOString(),
      ).toBe('2026-08-21T19:00:00.000Z');
    });

    it('millisekundni natijaga oqizmaydi', () => {
      expect(
        startOfDayInTimeZone('Asia/Tashkent', new Date('2026-08-21T12:34:56.789Z')).toISOString(),
      ).toBe('2026-08-20T19:00:00.000Z');
    });
  });

  describe('DST bor mintaqa (Europe/London)', () => {
    it("yoz o'rtasida UTC+1 bo'yicha hisoblaydi", () => {
      expect(
        startOfDayInTimeZone('Europe/London', new Date('2026-08-21T12:00:00Z')).toISOString(),
      ).toBe('2026-08-20T23:00:00.000Z');
    });

    it("DST boshlangan kunda kun boshi lokal yarim tunga to'g'ri keladi", () => {
      // 29-mart: soat 01:00 da UTC+0 -> UTC+1. Kun boshi hali UTC+0 da.
      expect(
        startOfDayInTimeZone('Europe/London', new Date('2026-03-29T12:00:00Z')).toISOString(),
      ).toBe('2026-03-29T00:00:00.000Z');
    });

    it("DST tugagan kunda ham to'g'ri ishlaydi", () => {
      // 25-oktabr: soat 02:00 da UTC+1 -> UTC+0. Kun boshi hali UTC+1 da.
      expect(
        startOfDayInTimeZone('Europe/London', new Date('2026-10-25T12:00:00Z')).toISOString(),
      ).toBe('2026-10-24T23:00:00.000Z');
    });
  });

  it('UTC uchun oddiy yarim tunni beradi', () => {
    expect(startOfDayInTimeZone('UTC', new Date('2026-08-21T12:34:56.789Z')).toISOString()).toBe(
      '2026-08-21T00:00:00.000Z',
    );
  });
});
