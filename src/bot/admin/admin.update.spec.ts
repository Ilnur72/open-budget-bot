import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AdminService } from '../../admin/admin.service';
import type { BotContext } from '../bot.types';
import { AdminUpdate } from './admin.update';
import { BroadcastService } from './broadcast.service';
import { PendingBroadcastStore } from './pending-broadcast.store';

const ADMIN_ID = 111;
const STRANGER_ID = 999;

const adminServiceMock = {
  isAdmin: jest.fn((id: number) => id === ADMIN_ID),
  getStats: jest.fn(),
  getTodayStats: jest.fn(),
  getRecentVotes: jest.fn(),
  getExportRows: jest.fn(),
  logAction: jest.fn(),
};

const broadcastMock = { broadcast: jest.fn(), isRunning: false };
const pendingMock = { save: jest.fn(), take: jest.fn(), clear: jest.fn() };
const configMock = { getOrThrow: jest.fn().mockReturnValue('Asia/Tashkent') };

/**
 * `register()` chaqirilganda ulangan handlerlarni ushlab qoladigan soxta bot.
 *
 * Table-driven yondashuv ataylab: kelajakda yangi admin handler qo'shilib
 * `guard()` unutilsa, shu test avtomatik yiqiladi.
 */
interface Captured {
  kind: 'command' | 'callback';
  name: string;
  handler: (ctx: BotContext) => Promise<void>;
}

function createFakeBot(): { bot: unknown; captured: Captured[] } {
  const captured: Captured[] = [];
  const bot = {
    command: (name: string, handler: (ctx: BotContext) => Promise<void>) => {
      captured.push({ kind: 'command', name, handler });
    },
    callbackQuery: (name: string | RegExp, handler: (ctx: BotContext) => Promise<void>) => {
      captured.push({ kind: 'callback', name: String(name), handler });
    },
  };
  return { bot, captured };
}

/** Non-admin kontekst — barcha javob metodlari kuzatiladi. */
function createContext(telegramId: number) {
  return {
    from: { id: telegramId, first_name: 'Test' },
    match: '',
    reply: jest.fn().mockResolvedValue({ chat: { id: 1 }, message_id: 1 }),
    replyWithDocument: jest.fn().mockResolvedValue({ chat: { id: 1 }, message_id: 2 }),
    answerCallbackQuery: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
    api: { editMessageText: jest.fn(), deleteMessage: jest.fn() },
  } as unknown as BotContext & {
    reply: jest.Mock;
    answerCallbackQuery: jest.Mock;
  };
}

describe('AdminUpdate — avtorizatsiya chegarasi', () => {
  let captured: Captured[];

  beforeEach(async () => {
    jest.clearAllMocks();
    adminServiceMock.isAdmin.mockImplementation((id: number) => id === ADMIN_ID);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUpdate,
        { provide: AdminService, useValue: adminServiceMock },
        { provide: BroadcastService, useValue: broadcastMock },
        { provide: PendingBroadcastStore, useValue: pendingMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    const fake = createFakeBot();
    moduleRef.get(AdminUpdate).register(fake.bot as never);
    captured = fake.captured;
  });

  it('kutilgan barcha buyruq va callbacklar ulanadi', () => {
    const commands = captured.filter((c) => c.kind === 'command').map((c) => c.name);

    expect(commands).toEqual(
      expect.arrayContaining(['admin', 'stats', 'today', 'users', 'recent', 'export', 'broadcast']),
    );
    expect(captured.filter((c) => c.kind === 'callback').length).toBeGreaterThanOrEqual(7);
  });

  it("HAR BIR handler admin bo'lmagan foydalanuvchini rad etadi", async () => {
    for (const entry of captured) {
      jest.clearAllMocks();
      adminServiceMock.isAdmin.mockImplementation((id: number) => id === ADMIN_ID);

      const ctx = createContext(STRANGER_ID);
      await entry.handler(ctx);

      // Hech qanday admin ma'lumoti o'qilmasligi yoki amal bajarilmasligi kerak.
      expect(adminServiceMock.getStats).not.toHaveBeenCalled();
      expect(adminServiceMock.getRecentVotes).not.toHaveBeenCalled();
      expect(adminServiceMock.getExportRows).not.toHaveBeenCalled();
      expect(adminServiceMock.getTodayStats).not.toHaveBeenCalled();
      expect(broadcastMock.broadcast).not.toHaveBeenCalled();
      expect(pendingMock.take).not.toHaveBeenCalled();
      expect(pendingMock.save).not.toHaveBeenCalled();
    }
  });

  it("buyruqlar rad javobi noma'lum buyruq javobi bilan bir xil", async () => {
    const command = captured.find((c) => c.kind === 'command' && c.name === 'stats');
    const ctx = createContext(STRANGER_ID);

    await command?.handler(ctx);

    // Aynan shu matn `BotUpdate.registerFallback` da ham ishlatiladi —
    // buyruq mavjudligi javob farqi orqali oshkor bo'lmasligi kerak.
    expect(ctx.reply).toHaveBeenCalledWith("❓ Noma'lum buyruq. Yordam uchun /help");
  });

  it("callback rad javobi MATNSIZ — noma'lum tugmadan farq qilmaydi", async () => {
    const callback = captured.find((c) => c.kind === 'callback');
    const ctx = createContext(STRANGER_ID);

    await callback?.handler(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
  });

  it('admin uchun amal bajariladi', async () => {
    adminServiceMock.getStats.mockResolvedValue({
      total: 1,
      success: 1,
      failed: 0,
      pending: 0,
      totalUsers: 1,
      blockedUsers: 0,
      uniqueSuccessfulPhones: 1,
      successRate: '100.0',
    });

    const command = captured.find((c) => c.kind === 'command' && c.name === 'stats');
    await command?.handler(createContext(ADMIN_ID));

    expect(adminServiceMock.getStats).toHaveBeenCalled();
  });
});
