import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { UserService } from './user.service';

const prismaMock = {
  user: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 1,
  telegramId: 123n,
  firstName: 'Ali',
  lastName: null,
  username: 'ali',
  phone: null,
  isAdmin: false,
  isBlocked: false,
  createdAt: new Date('2026-08-21T00:00:00Z'),
  updatedAt: new Date('2026-08-21T00:00:00Z'),
  ...overrides,
});

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UserService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(UserService);
  });

  describe('findOrCreate', () => {
    it('upsert bilan yaratadi va profilni yangilaydi', async () => {
      prismaMock.user.upsert.mockResolvedValue(buildUser());

      await service.findOrCreate(123n, { firstName: 'Ali', username: 'ali' });

      expect(prismaMock.user.upsert).toHaveBeenCalledWith({
        where: { telegramId: 123n },
        create: { telegramId: 123n, firstName: 'Ali', username: 'ali' },
        // `isBlocked: false` — foydalanuvchi botga yozyapti, demak bloklamagan.
        // Aks holda u broadcast'lardan abadiy chiqib qolardi.
        update: { firstName: 'Ali', username: 'ali', isBlocked: false },
      });
    });

    it('profil berilmasa ham ishlaydi', async () => {
      prismaMock.user.upsert.mockResolvedValue(buildUser());

      await service.findOrCreate(999n);

      expect(prismaMock.user.upsert).toHaveBeenCalledWith({
        where: { telegramId: 999n },
        create: { telegramId: 999n },
        update: { isBlocked: false },
      });
    });
  });

  describe('findByTelegramId', () => {
    it('topilmasa null qaytaradi', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.findByTelegramId(404n)).resolves.toBeNull();
    });

    it('topilganda foydalanuvchini qaytaradi', async () => {
      prismaMock.user.findUnique.mockResolvedValue(buildUser({ id: 42 }));

      await expect(service.findByTelegramId(123n)).resolves.toMatchObject({ id: 42 });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { telegramId: 123n } });
    });
  });

  describe('updatePhone', () => {
    it('raqamni saqlaydi', async () => {
      prismaMock.user.update.mockResolvedValue(buildUser({ phone: '+998901234567' }));

      const user = await service.updatePhone(1, '+998901234567');

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { phone: '+998901234567' },
      });
      expect(user.phone).toBe('+998901234567');
    });

    it('raqamni normalizatsiya qilib saqlaydi', async () => {
      prismaMock.user.update.mockResolvedValue(buildUser({ phone: '+998901234567' }));

      // `votes.phone` bilan bir xil formatda bo'lishi shart.
      await service.updatePhone(1, '998 90 123 45 67');

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { phone: '+998901234567' },
      });
    });
  });
});
