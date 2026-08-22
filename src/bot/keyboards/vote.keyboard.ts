import { InlineKeyboard } from 'grammy';

export function buildMainKeyboard(officialBotUrl: string): InlineKeyboard {
  return new InlineKeyboard().url('🗳 Ovoz berish', officialBotUrl);
}

export function buildOfficialBotUrl(botUsername: string, publicId: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(publicId)}`;
}
