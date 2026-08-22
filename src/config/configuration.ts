export interface AppConfig {
  port: number;
  nodeEnv: string;
}

export type BotMode = 'polling' | 'webhook';

export interface BotConfig {
  token: string;
  mode: BotMode;
  webhookUrl?: string;
  webhookSecret?: string;
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

function requireBotMode(): BotMode {
  const value = optionalEnv('BOT_MODE', 'polling');
  if (value !== 'polling' && value !== 'webhook') {
    throw new Error(
      'Environment variable "BOT_MODE" faqat "polling" yoki "webhook" bo\'lishi mumkin',
    );
  }
  return value;
}

function requireWebhookSecret(): string {
  const value = requireEnv('WEBHOOK_SECRET');
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(value)) {
    throw new Error(
      'Environment variable "WEBHOOK_SECRET" kamida 16 belgi va faqat A-Z a-z 0-9 _ - dan iborat bo\'lishi kerak',
    );
  }
  return value;
}

function requireHttpsUrl(key: string): string {
  const value = requireEnv(key);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Environment variable "${key}" haqiqiy URL bo'lishi kerak`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Environment variable "${key}" https:// bilan boshlanishi kerak`);
  }
  return value;
}

export default (): Configuration => {
  const botMode = requireBotMode();

  return {
    app: {
      port: optionalNumberEnv('PORT', 3000),
      nodeEnv: optionalEnv('NODE_ENV', 'development'),
    },
    bot: {
      token: requireEnv('BOT_TOKEN'),
      mode: botMode,
      ...(botMode === 'webhook'
        ? { webhookUrl: requireHttpsUrl('WEBHOOK_URL'), webhookSecret: requireWebhookSecret() }
        : {}),
    },
    openbudget: {
      officialBot: optionalEnv('OPENBUDGET_BOT', 'ochiqbudjetbot'),
      initiativePublicId: requireEnv('INITIATIVE_PUBLIC_ID'),
    },
  };
};
