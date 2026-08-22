import configuration from './configuration';

const VALID_ENV: NodeJS.ProcessEnv = {
  BOT_TOKEN: 'test-token',
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

  it("ixtiyoriy env uchun default qiymatlarni qo'yadi", () => {
    const config = configuration();
    expect(config.app.port).toBe(3000);
    expect(config.app.nodeEnv).toBe('development');
    expect(config.openbudget.officialBot).toBe('ochiqbudjetbot');
  });
});
