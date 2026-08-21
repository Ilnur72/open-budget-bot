import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient, VoteStatus } from '@prisma/client';

/**
 * Haqiqiy PostgreSQL'ga qarshi ishlaydigan test.
 *
 * Nima uchun kerak: dublikat ovozni to'sadigan `votes_initiative_phone_success_key`
 * va telefon formati CHECK cheklovi faqat qo'lda yozilgan SQL migratsiyada yashaydi —
 * ular Prisma schema'sida ko'rinmaydi. Kimdir migratsiyani qayta yaratsa yoki
 * `prisma migrate reset` qilsa, ular jimgina yo'qolishi mumkin.
 */
describe('Database cheklovlari (e2e)', () => {
  const TELEGRAM_ID = 900000000000n;
  const INITIATIVE = 'e2e-initiative-uuid';
  const PHONE = '+998900000042';

  let prisma: PrismaClient;
  let userId: number;

  beforeAll(async () => {
    // `.env` jest'ning `setupFiles: ["dotenv/config"]` orqali yuklanadi:
    // jest `process.env` ni izolyatsiya qilgani uchun `process.loadEnvFile()` bu yerda ko'rinmaydi.
    prisma = new PrismaClient({
      adapter: new PrismaPg(process.env.DATABASE_URL ?? ''),
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.voteLog.deleteMany({ where: { user: { telegramId: TELEGRAM_ID } } });
    await prisma.vote.deleteMany({ where: { user: { telegramId: TELEGRAM_ID } } });
    await prisma.user.deleteMany({ where: { telegramId: TELEGRAM_ID } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.vote.deleteMany({ where: { user: { telegramId: TELEGRAM_ID } } });
    await prisma.user.deleteMany({ where: { telegramId: TELEGRAM_ID } });
    const user = await prisma.user.create({
      data: { telegramId: TELEGRAM_ID, firstName: 'E2E' },
    });
    userId = user.id;
  });

  const createVote = () =>
    prisma.vote.create({
      data: { userId, phone: PHONE, initiativeUuid: INITIATIVE, districtId: 55 },
    });

  it('bir xil raqamdan bir nechta yakunlanmagan urinishga ruxsat beradi', async () => {
    await expect(createVote()).resolves.toMatchObject({ status: VoteStatus.PENDING });
    await expect(createVote()).resolves.toMatchObject({ status: VoteStatus.PENDING });
  });

  it('ikkinchi SUCCESS ni P2002 bilan bloklaydi', async () => {
    const first = await createVote();
    const second = await createVote();

    await prisma.vote.update({ where: { id: first.id }, data: { status: VoteStatus.SUCCESS } });

    const error: unknown = await prisma.vote
      .update({ where: { id: second.id }, data: { status: VoteStatus.SUCCESS } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
  });

  it('muvaffaqiyatsiz urinishlar cheklanmaydi', async () => {
    const first = await createVote();
    const second = await createVote();

    await prisma.vote.update({ where: { id: first.id }, data: { status: VoteStatus.FAILED } });
    await expect(
      prisma.vote.update({ where: { id: second.id }, data: { status: VoteStatus.FAILED } }),
    ).resolves.toMatchObject({ status: VoteStatus.FAILED });
  });

  it("ayni qatorni SUCCESS -> SUCCESS yangilash yolg'on dublikat bermaydi", async () => {
    const vote = await createVote();
    await prisma.vote.update({ where: { id: vote.id }, data: { status: VoteStatus.SUCCESS } });

    await expect(
      prisma.vote.update({ where: { id: vote.id }, data: { status: VoteStatus.SUCCESS } }),
    ).resolves.toMatchObject({ status: VoteStatus.SUCCESS });
  });

  it.each(['998900000042', '+998 90 000 00 42', '900000042'])(
    'normalizatsiyalanmagan raqamni (%s) CHECK cheklovi rad etadi',
    async (rawPhone) => {
      await expect(
        prisma.vote.create({
          data: { userId, phone: rawPhone, initiativeUuid: INITIATIVE, districtId: 55 },
        }),
      ).rejects.toThrow();
    },
  );

  it('created_at UTC saqlanadi (timestamptz)', async () => {
    const before = Date.now();
    const vote = await createVote();
    const drift = Math.abs(vote.createdAt.getTime() - before);

    // Vaqt mintaqasi noto'g'ri bo'lsa farq soatlarda o'lchanardi.
    expect(drift).toBeLessThan(60_000);
  });
});
