import configuration from './configuration';

/** Testlar uchun to'liq env to'plami — har bir test shundan boshlanadi. */
const VALID_ENV: NodeJS.ProcessEnv = {
  BOT_TOKEN: 'test-token',
  WEBAPP_URL: 'https://example.com/webapp/captcha.html',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  DISTRICT_ID: '55',
  INITIATIVE_UUID: '2f9c2e42-2e3c-46cb-a5af-bc7976cc0dec',
  INITIATIVE_URL: 'https://new.openbudget.uz/uz/initiative-budget',
  INITIATIVE_PUBLIC_ID: '055501602005',
};

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...VALID_ENV };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("majburiy env yo'q bo'lsa xatolik beradi", () => {
    delete process.env.BOT_TOKEN;
    expect(() => configuration()).toThrow(/BOT_TOKEN/);
  });

  it("ADMIN_IDS ro'yxatidan faqat to'g'ri ID'larni oladi", () => {
    process.env.ADMIN_IDS = '123, 456 ,abc,0,-5';
    expect(configuration().bot.adminIds).toEqual([123, 456]);
  });

  it("ADMIN_IDS bo'sh bo'lsa bo'sh massiv qaytaradi", () => {
    expect(configuration().bot.adminIds).toEqual([]);
  });

  it("ixtiyoriy env uchun default qiymatlarni qo'yadi", () => {
    const config = configuration();
    expect(config.app.port).toBe(3000);
    expect(config.app.nodeEnv).toBe('development');
    expect(config.openbudget.baseUrl).toBe('https://new.openbudget.uz');
  });
});
