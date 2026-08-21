import { Test } from '@nestjs/testing';
import { RedisService } from '../redis/redis.service';
import { ThrottleService } from './throttle.service';

const execMock = jest.fn();
const multiMock = { incr: jest.fn(), expire: jest.fn(), exec: execMock };
const clientMock = { multi: jest.fn() };

describe('ThrottleService', () => {
  let service: ThrottleService;

  beforeEach(async () => {
    jest.resetAllMocks();
    clientMock.multi.mockReturnValue(multiMock);
    multiMock.incr.mockReturnValue(multiMock);
    multiMock.expire.mockReturnValue(multiMock);

    const moduleRef = await Test.createTestingModule({
      providers: [ThrottleService, { provide: RedisService, useValue: { client: clientMock } }],
    }).compile();
    service = moduleRef.get(ThrottleService);
  });

  const okExec = (value: number) => [
    [null, value],
    [null, 1],
  ];

  it('chegara ichida false qaytaradi', async () => {
    execMock.mockResolvedValue(okExec(5));

    await expect(service.isExceeded('k', 10, 60)).resolves.toBe(false);
    expect(multiMock.incr).toHaveBeenCalledWith('k');
    expect(multiMock.expire).toHaveBeenCalledWith('k', 60, 'NX');
  });

  it('aynan chegarada hali ruxsat beradi', async () => {
    execMock.mockResolvedValue(okExec(10));

    await expect(service.isExceeded('k', 10, 60)).resolves.toBe(false);
  });

  it('chegaradan oshsa true', async () => {
    execMock.mockResolvedValue(okExec(11));

    await expect(service.isExceeded('k', 10, 60)).resolves.toBe(true);
  });

  describe('fail-open', () => {
    // Bu ATAYLAB `VoteRateLimiter` dan farq qiladi: throttle xavfsizlik
    // chegarasi emas, Redis nosozligi butun botni to'xtatmasligi kerak.
    it('Redis yiqilsa ruxsat beradi', async () => {
      execMock.mockRejectedValue(new Error('Redis uzildi'));

      await expect(service.isExceeded('k', 10, 60)).resolves.toBe(false);
    });

    it('exec null qaytarsa ruxsat beradi', async () => {
      execMock.mockResolvedValue(null);

      await expect(service.isExceeded('k', 10, 60)).resolves.toBe(false);
    });

    it('kutilmagan javob tipida ruxsat beradi', async () => {
      execMock.mockResolvedValue([
        [null, 'nima'],
        [null, 1],
      ]);

      await expect(service.isExceeded('k', 10, 60)).resolves.toBe(false);
    });
  });
});
