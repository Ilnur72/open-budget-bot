import { createHmac } from 'node:crypto';
import { verifyInitData } from './init-data.util';

const BOT_TOKEN = '123456:TEST-TOKEN';

/** Haqiqiy Telegram imzosi bilan initData yasaydi. */
function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

const now = () => Math.floor(Date.now() / 1000);

const validFields = (overrides: Record<string, string> = {}) => ({
  auth_date: String(now()),
  query_id: 'AAA',
  user: JSON.stringify({ id: 555, first_name: 'Ali', username: 'ali' }),
  ...overrides,
});

describe('verifyInitData', () => {
  it('haqiqiy imzoni qabul qiladi va foydalanuvchini qaytaradi', () => {
    const initData = signInitData(validFields());

    expect(verifyInitData(initData, BOT_TOKEN)).toEqual({
      id: 555,
      firstName: 'Ali',
      username: 'ali',
    });
  });

  it('buzilgan imzoni rad etadi', () => {
    const initData = signInitData(validFields());
    const tampered = initData.replace(/hash=[0-9a-f]+/, `hash=${'0'.repeat(64)}`);

    expect(verifyInitData(tampered, BOT_TOKEN)).toBeNull();
  });

  it("ma'lumot o'zgartirilsa rad etadi", () => {
    const initData = signInitData(validFields());
    // Foydalanuvchi ID sini boshqasiga almashtirish — imzo mos kelmay qoladi.
    const tampered = initData.replace('555', '999');

    expect(verifyInitData(tampered, BOT_TOKEN)).toBeNull();
  });

  it("boshqa bot tokeni bilan imzolangan bo'lsa rad etadi", () => {
    const initData = signInitData(validFields());

    expect(verifyInitData(initData, '999999:BOSHQA-TOKEN')).toBeNull();
  });

  it('eski auth_date ni rad etadi', () => {
    const twoHoursAgo = String(now() - 2 * 60 * 60);
    const initData = signInitData(validFields({ auth_date: twoHoursAgo }));

    // Imzo to'g'ri, lekin muddati o'tgan — o'g'irlangan initData abadiy ishlamasin.
    expect(verifyInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it('soat farqiga bardosh beradi', () => {
    // Server soati Telegram'nikidan bir necha soniya orqada bo'lishi mumkin.
    const initData = signInitData(validFields({ auth_date: String(now() + 30) }));

    expect(verifyInitData(initData, BOT_TOKEN)).not.toBeNull();
  });

  it('juda uzoq kelajakdagi auth_date ni rad etadi', () => {
    const initData = signInitData(validFields({ auth_date: String(now() + 3600) }));

    expect(verifyInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it.each([
    ['', "bo'sh satr"],
    ['hash=abc', 'hash formati xato'],
    ['user=%7B%7D', "hash yo'q"],
  ])('yaroqsiz kirishni rad etadi: %s (%s)', (initData) => {
    expect(verifyInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it("user maydoni yaroqsiz bo'lsa rad etadi", () => {
    expect(verifyInitData(signInitData(validFields({ user: 'buzilgan' })), BOT_TOKEN)).toBeNull();
    expect(
      verifyInitData(signInitData(validFields({ user: JSON.stringify({ id: 'x' }) })), BOT_TOKEN),
    ).toBeNull();
    expect(
      verifyInitData(signInitData(validFields({ user: JSON.stringify({ id: -1 }) })), BOT_TOKEN),
    ).toBeNull();
  });

  it('ixtiyoriy maydonlarsiz ham ishlaydi', () => {
    const initData = signInitData(validFields({ user: JSON.stringify({ id: 42 }) }));

    expect(verifyInitData(initData, BOT_TOKEN)).toEqual({ id: 42 });
  });
});
