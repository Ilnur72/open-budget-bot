import { Test } from '@nestjs/testing';
import { RedisService } from '../../common/redis/redis.service';
import { PendingBroadcastStore } from './pending-broadcast.store';

const execMock = jest.fn();
const multiMock = { get: jest.fn(), del: jest.fn(), exec: execMock };
const clientMock = { set: jest.fn(), del: jest.fn(), multi: jest.fn() };

const ID = 'test-id';
const KEY = `admin:broadcast:pending:111:${ID}`;

describe('PendingBroadcastStore', () => {
  let store: PendingBroadcastStore;

  beforeEach(async () => {
    jest.resetAllMocks();
    clientMock.multi.mockReturnValue(multiMock);
    multiMock.get.mockReturnValue(multiMock);
    multiMock.del.mockReturnValue(multiMock);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PendingBroadcastStore,
        { provide: RedisService, useValue: { client: clientMock } },
      ],
    }).compile();
    store = moduleRef.get(PendingBroadcastStore);
  });

  it('matnni TTL bilan saqlaydi va ID qaytaradi', async () => {
    const id = await store.save(111, 'salom');

    // Har bir matn o'z ID siga ega — eski tugma yangi matnni yubormasin.
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(clientMock.set).toHaveBeenCalledWith(
      `admin:broadcast:pending:111:${id}`,
      'salom',
      'EX',
      300,
    );
  });

  it("o'qish bilan birga o'chiradi — ikki marta yuborilmasin", async () => {
    execMock.mockResolvedValue([
      [null, 'salom'],
      [null, 1],
    ]);

    await expect(store.take(111, ID)).resolves.toBe('salom');
    expect(multiMock.del).toHaveBeenCalledWith(KEY);
  });

  it("muddati o'tgan bo'lsa null", async () => {
    execMock.mockResolvedValue([
      [null, null],
      [null, 0],
    ]);

    await expect(store.take(111, ID)).resolves.toBeNull();
  });

  it('exec null qaytarsa yiqilmaydi', async () => {
    execMock.mockResolvedValue(null);

    await expect(store.take(111, ID)).resolves.toBeNull();
  });

  it('tozalaydi', async () => {
    await store.clear(111, ID);

    expect(clientMock.del).toHaveBeenCalledWith(KEY);
  });
});
