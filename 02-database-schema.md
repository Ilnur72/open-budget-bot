# 02 — Database Schema (Prisma)

## Vazifa

`prisma/schema.prisma` faylini yarat va migrate qil.

### Schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  // Prisma 7: ulanish manzili bu yerda emas, prisma.config.ts da turadi
}

model User {
  id          Int      @id @default(autoincrement())
  telegramId  BigInt   @unique @map("telegram_id")
  firstName   String?  @map("first_name")
  lastName    String?  @map("last_name")
  username    String?
  phone       String?  // oxirgi ishlatilgan raqam
  isAdmin     Boolean  @default(false) @map("is_admin")
  isBlocked   Boolean  @default(false) @map("is_blocked")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  votes       Vote[]
  voteLogs    VoteLog[]

  @@map("users")
}

model Vote {
  id             Int        @id @default(autoincrement())
  userId         Int        @map("user_id")
  phone          String     // ovoz berilgan raqam
  initiativeUuid String     @map("initiative_uuid")
  districtId     Int        @map("district_id")
  status         VoteStatus @default(PENDING)
  errorMessage   String?    @map("error_message")
  createdAt      DateTime   @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@map("votes")
}

model VoteLog {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  action    String   // CAPTCHA_REQUESTED, CODE_SENT, CODE_VERIFIED, VOTE_SUCCESS, VOTE_FAILED
  details   Json?
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@map("vote_logs")
}

enum VoteStatus {
  PENDING
  CAPTCHA_SENT
  CODE_SENT
  VERIFIED
  SUCCESS
  FAILED
}
```

### Talablar:

1. `npx prisma migrate dev --name init` bilan migrate qil
   (ulanish manzili `prisma.config.ts` dan olinadi — 01-bosqichda yaratilgan)
2. `PrismaService` allaqachon mavjud (`src/common/prisma/prisma.service.ts`) —
   Prisma 7 da u `@prisma/adapter-pg` driver adapteri orqali ulanadi:
   `super({ adapter: new PrismaPg(configService.getOrThrow('database.url')) })`.
   Uni qayta yozish shart emas, faqat kerak bo'lsa kengaytir.
3. `UserService` da `findOrCreate(telegramId, data)` metodi bo'lsin
4. `VoteService` da:
   - `create(userId, phone, initiativeUuid, districtId)`
   - `updateStatus(voteId, status, errorMessage?)`
   - `getStats()` — umumiy, muvaffaqiyatli, muvaffaqiyatsiz sonlari
   - `getTodayStats()` — bugungi statistika
   - `getByUser(userId)` — foydalanuvchining ovozlari
