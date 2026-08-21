import { Test } from '@nestjs/testing';
import { GrammyError } from 'grammy';
import type { Api } from 'grammy';
import { AdminService } from '../../admin/admin.service';
import { BroadcastService } from './broadcast.service';

const adminMock = {
  getBroadcastTargets: jest.fn(),
  markBlocked: jest.fn(),
};

const sendMessage = jest.fn();
const api = { sendMessage } as unknown as Api;

/** Telegram 403 xatoligini taqlid qiladi (foydalanuvchi botni bloklagan). */
const blockedError = (): GrammyError =>
  new GrammyError(
    'Forbidden',
    { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
    'sendMessage',
    {},
  );

const user = (id: number) => ({ id, telegramId: BigInt(1000 + id) });

describe('BroadcastService', () => {
  let service: BroadcastService;

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    adminMock.markBlocked.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [BroadcastService, { provide: AdminService, useValue: adminMock }],
    }).compile();
    service = moduleRef.get(BroadcastService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Xabarlar orasidagi pauzalarni tezlashtiradi. */
  const run = async <T>(promise: Promise<T>): Promise<T> => {
    const settled = promise.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await jest.runAllTimersAsync();
    const result = await settled;
    if ('error' in result) {
      throw result.error;
    }
    return result.value;
  };

  it('barcha foydalanuvchilarga yuboradi va sahifalaydi', async () => {
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce([user(1), user(2)])
      .mockResolvedValueOnce([user(3)])
      .mockResolvedValueOnce([]);
    sendMessage.mockResolvedValue({});

    const progress = await run(service.broadcast(api, 'salom'));

    expect(progress).toEqual({ sent: 3, blocked: 0, failed: 0, total: 3 });
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenCalledWith(1001, 'salom', { parse_mode: 'HTML' });
  });

  it('botni bloklagan foydalanuvchini DB da belgilaydi', async () => {
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce([user(1), user(2)])
      .mockResolvedValueOnce([]);
    sendMessage.mockRejectedValueOnce(blockedError()).mockResolvedValueOnce({});

    const progress = await run(service.broadcast(api, 'salom'));

    expect(progress).toMatchObject({ sent: 1, blocked: 1, failed: 0 });
    // Keyingi broadcast'da bu foydalanuvchiga bekorga urinilmasin.
    expect(adminMock.markBlocked).toHaveBeenCalledWith(1);
  });

  it("bitta xatolik butun broadcast'ni to'xtatmaydi", async () => {
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce([user(1), user(2), user(3)])
      .mockResolvedValueOnce([]);
    sendMessage
      .mockRejectedValueOnce(new Error('tarmoq'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const progress = await run(service.broadcast(api, 'salom'));

    expect(progress).toMatchObject({ sent: 2, failed: 1, total: 3 });
  });

  it('har sahifadan keyin holatni xabar qiladi', async () => {
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce([user(1)])
      .mockResolvedValueOnce([user(2)])
      .mockResolvedValueOnce([]);
    sendMessage.mockResolvedValue({});
    const onProgress = jest.fn();

    await run(service.broadcast(api, 'salom', onProgress));

    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('bir vaqtda ikkita broadcast ishlamaydi', async () => {
    adminMock.getBroadcastTargets.mockResolvedValueOnce([user(1)]).mockResolvedValue([]);
    sendMessage.mockResolvedValue({});

    const first = service.broadcast(api, 'birinchi');
    expect(service.isRunning).toBe(true);
    await expect(service.broadcast(api, 'ikkinchi')).rejects.toThrow();

    await run(first);
    expect(service.isRunning).toBe(false);
  });

  it('yiqilsa ham qulf ochiladi', async () => {
    adminMock.getBroadcastTargets.mockRejectedValue(new Error('DB uzildi'));

    await expect(run(service.broadcast(api, 'salom'))).rejects.toThrow('DB uzildi');
    expect(service.isRunning).toBe(false);
  });
  it('xabarlar orasida 50 ms pauza qiladi', async () => {
    adminMock.getBroadcastTargets.mockResolvedValueOnce([user(1), user(2)]).mockResolvedValue([]);
    sendMessage.mockResolvedValue({});

    const promise = service.broadcast(api, 'salom');
    await jest.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // 49 ms — hali ikkinchisi ketmaydi (Telegram chegarasiga rioya).
    await jest.advanceTimersByTimeAsync(49);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    await run(promise);
  });

  it("'chat not found' ni ham bloklangan deb hisoblaydi", async () => {
    adminMock.getBroadcastTargets.mockResolvedValueOnce([user(1)]).mockResolvedValueOnce([]);
    sendMessage.mockRejectedValue(
      new GrammyError(
        'Bad Request',
        { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
        'sendMessage',
        {},
      ),
    );

    const progress = await run(service.broadcast(api, 'salom'));

    expect(progress).toMatchObject({ blocked: 1, failed: 0 });
  });

  it('markBlocked yiqilsa ham davom etadi', async () => {
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce([user(1), user(2)])
      .mockResolvedValueOnce([]);
    sendMessage.mockRejectedValueOnce(blockedError()).mockResolvedValueOnce({});
    adminMock.markBlocked.mockRejectedValue(new Error('DB uzildi'));

    const progress = await run(service.broadcast(api, 'salom'));

    expect(progress).toMatchObject({ sent: 1, blocked: 1 });
  });

  it("ketma-ket 50 ta xatodan keyin to'xtaydi", async () => {
    // Buzuq HTML bilan har xabar 400 beradi — 50k × 50ms ≈ 42 daqiqa bekorga.
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => user(i + 1)))
      .mockResolvedValue([]);
    sendMessage.mockRejectedValue(new Error("can't parse entities"));

    await expect(run(service.broadcast(api, '<b>buzuq'))).rejects.toThrow(/Ketma-ket/);
    expect(sendMessage.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("ilova to'xtaganda broadcast uziladi", async () => {
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce([user(1)])
      .mockResolvedValueOnce([user(2)])
      .mockResolvedValue([]);
    sendMessage.mockResolvedValue({});

    const promise = service.broadcast(api, 'salom');
    // Birinchi sahifa yuborilib, pauzada turgan payt.
    await jest.advanceTimersByTimeAsync(1);
    const shutdown = service.onApplicationShutdown();

    await run(promise);
    await shutdown;

    // Ikkinchi sahifa umuman o'qilmagan — joriy sahifa tugab, sikl to'xtagan.
    expect(adminMock.getBroadcastTargets).toHaveBeenCalledTimes(1);
    expect(service.isRunning).toBe(false);
  });

  it("sahifa OʻRTASIDA ham darhol to'xtaydi", async () => {
    // Faqat sahifalar orasida tekshirilsa, 500 xabarlik sahifa tugashini
    // kutish kerak bo'lardi (25s+) va SIGKILL tushardi.
    adminMock.getBroadcastTargets
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => user(i + 1)))
      .mockResolvedValue([]);
    sendMessage.mockResolvedValue({});

    const promise = service.broadcast(api, 'salom');
    await jest.advanceTimersByTimeAsync(120);
    const sentBeforeAbort = sendMessage.mock.calls.length;

    const shutdown = service.onApplicationShutdown();
    await run(promise);
    await shutdown;

    // Abort'dan keyin ko'pi bilan bitta xabar ketishi mumkin (joriy `await`).
    expect(sendMessage.mock.calls.length).toBeLessThanOrEqual(sentBeforeAbort + 1);
    expect(sendMessage.mock.calls.length).toBeLessThan(100);
  });
});
