import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Update } from 'grammy/types';
import { BotService } from './bot.service';
import { TelegramWebhookController } from './webhook.controller';

const SECRET = 'a'.repeat(32);
const UPDATE = { update_id: 1 } as Update;

const botServiceMock = { handleUpdate: jest.fn() };
const CONFIG: Record<string, string> = {
  'bot.mode': 'webhook',
  'bot.webhookSecret': SECRET,
};
const configMock = { getOrThrow: jest.fn((key: string) => CONFIG[key]) };

describe('TelegramWebhookController', () => {
  let controller: TelegramWebhookController;

  beforeEach(async () => {
    jest.clearAllMocks();
    CONFIG['bot.mode'] = 'webhook';
    configMock.getOrThrow.mockImplementation((key: string) => CONFIG[key]);
    botServiceMock.handleUpdate.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramWebhookController],
      providers: [
        { provide: BotService, useValue: botServiceMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    controller = moduleRef.get(TelegramWebhookController);
  });

  it("to'g'ri secret bilan update'ni botga uzatadi", async () => {
    await controller.handle(UPDATE, SECRET);

    expect(botServiceMock.handleUpdate).toHaveBeenCalledWith(UPDATE);
  });

  const INVALID_SECRETS: Array<{ label: string; value: string | undefined }> = [
    { label: "sarlavha yo'q", value: undefined },
    { label: "bo'sh", value: '' },
    { label: 'boshqa qiymat', value: 'b'.repeat(32) },
    { label: 'qisqaroq', value: 'a'.repeat(31) },
    { label: 'uzunroq', value: 'a'.repeat(33) },
  ];

  it.each(INVALID_SECRETS)("noto'g'ri secret rad etiladi ($label)", async ({ value }) => {
    await expect(controller.handle(UPDATE, value)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(botServiceMock.handleUpdate).not.toHaveBeenCalled();
  });

  it('polling rejimida endpoint yopiq', async () => {
    CONFIG['bot.mode'] = 'polling';

    await expect(controller.handle(UPDATE, SECRET)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(botServiceMock.handleUpdate).not.toHaveBeenCalled();
  });
});
