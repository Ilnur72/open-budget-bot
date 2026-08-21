import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { HealthController } from './health.controller';

const prismaMock = { $queryRaw: jest.fn() };
const redisMock = { client: { ping: jest.fn() } };

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisMock.client.ping.mockResolvedValue('PONG');

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  describe('liveness', () => {
    it('uptime bilan ok qaytaradi', () => {
      const result = controller.liveness();

      expect(result.status).toBe('ok');
      expect(typeof result.uptime).toBe('number');
    });

    it("tashqi bog'liqliklarga MUROJAAT QILMAYDI", () => {
      controller.liveness();

      // Docker healthcheck shuni chaqiradi: DB tushganda konteynerni qayta
      // ishga tushirish muammoni hal qilmaydi.
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      expect(redisMock.client.ping).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('ikkalasi ishlasa ok', async () => {
      await expect(controller.readiness()).resolves.toEqual({
        status: 'ok',
        checks: { database: true, redis: true },
      });
    });

    it.each([
      ['database', () => prismaMock.$queryRaw.mockRejectedValue(new Error('uzildi'))],
      ['redis', () => redisMock.client.ping.mockRejectedValue(new Error('uzildi'))],
    ])('%s tushsa 503 qaytaradi', async (name, breakIt) => {
      breakIt();

      const error = await controller.readiness().catch((e: unknown) => e);

      // 503 SHART: LB status kodiga qaraydi, 200 bo'lsa buzuq ilovaga trafik ketardi.
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      const body = (error as HttpException).getResponse() as {
        status: string;
        checks: Record<string, boolean>;
      };
      expect(body.status).toBe('degraded');
      expect(body.checks[name]).toBe(false);
    });

    it("bog'liqlik osilib qolsa ham javob beradi", async () => {
      jest.useFakeTimers();
      prismaMock.$queryRaw.mockReturnValue(new Promise(() => undefined));

      const settled = controller.readiness().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(2_100);

      // Timeout bo'lsa ham javob beradi (osilib qolmaydi) va 503 qaytaradi.
      const result = await settled;
      expect(result).toBeInstanceOf(HttpException);
      expect((result as HttpException).getStatus()).toBe(503);
      jest.useRealTimers();
    });
  });
});
