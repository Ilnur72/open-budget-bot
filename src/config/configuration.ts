export interface AppConfig {
  port: number;
  nodeEnv: string;
}

export interface BotConfig {
  token: string;
}

export interface OpenBudgetConfig {
  officialBot: string;
  initiativePublicId: string;
}

export interface Configuration {
  app: AppConfig;
  bot: BotConfig;
  openbudget: OpenBudgetConfig;
}

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `Environment variable "${key}" majburiy, lekin o'rnatilmagan (.env faylni tekshiring)`,
    );
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function optionalNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Environment variable "${key}" butun son bo'lishi kerak`);
  }
  return value;
}

export default (): Configuration => ({
  app: {
    port: optionalNumberEnv('PORT', 3000),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
  },
  bot: {
    token: requireEnv('BOT_TOKEN'),
  },
  openbudget: {
    officialBot: optionalEnv('OPENBUDGET_BOT', 'ochiqbudjetbot'),
    initiativePublicId: requireEnv('INITIATIVE_PUBLIC_ID'),
  },
});
