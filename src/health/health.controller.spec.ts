import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('uptime bilan ok qaytaradi', () => {
    const result = controller.liveness();

    expect(result.status).toBe('ok');
    expect(typeof result.uptime).toBe('number');
  });
});
