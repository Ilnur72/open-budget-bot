# 01 — Loyihani yaratish va asosiy sozlamalar

## Vazifa

NestJS loyihasini yarat va quyidagi kutubxonalarni o'rnat:

### Loyiha nomi: `openbudget-bot`

### Kerakli paketlar:

```bash
# NestJS
@nestjs/core @nestjs/common @nestjs/platform-express @nestjs/config

# Telegram Bot
grammy @grammyjs/conversations @grammyjs/session

# Database
prisma @prisma/client

# Redis
ioredis @grammyjs/storage-redis

# HTTP
axios

# Utilities
class-validator class-transformer
```

### Loyiha tuzilmasi:

```
src/
├── app.module.ts
├── main.ts
├── bot/
│   ├── bot.module.ts
│   ├── bot.service.ts          # Bot instance va middleware
│   ├── bot.update.ts           # Command/message handlers
│   ├── conversations/
│   │   └── vote.conversation.ts # Ovoz berish step-by-step flow
│   └── keyboards/
│       └── vote.keyboard.ts    # Inline keyboard layoutlar
├── openbudget/
│   ├── openbudget.module.ts
│   ├── openbudget.service.ts   # API bilan ishlash
│   └── openbudget.types.ts     # Type/interface'lar
├── user/
│   ├── user.module.ts
│   └── user.service.ts         # Foydalanuvchi CRUD
├── vote/
│   ├── vote.module.ts
│   └── vote.service.ts         # Ovoz CRUD va statistika
├── admin/
│   ├── admin.module.ts
│   └── admin.service.ts        # Admin buyruqlari
├── webapp/                     # Captcha uchun Mini App
│   └── captcha.html
└── config/
    └── configuration.ts
```

### .env fayl:

```env
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=postgresql://user:pass@localhost:5432/openbudget_bot
REDIS_URL=redis://localhost:6379

# OpenBudget
OPENBUDGET_BASE_URL=https://new.openbudget.uz
INITIATIVE_URL=https://new.openbudget.uz/uz/initiative-budget/active-initiatives/55/2f9c2e42-2e3c-46cb-a5af-bc7976cc0dec
DISTRICT_ID=55
INITIATIVE_UUID=2f9c2e42-2e3c-46cb-a5af-bc7976cc0dec

# Admin
ADMIN_IDS=123456789,987654321

# WebApp
WEBAPP_URL=https://your-domain.com/captcha
```

### main.ts:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // Captcha WebApp uchun static fayllar
  app.useStaticAssets(join(__dirname, '..', 'src', 'webapp'), {
    prefix: '/webapp/',
  });
  
  await app.listen(3000);
}
bootstrap();
```

### Talablar:

1. Barcha modullarni `app.module.ts` da import qil
2. `ConfigModule.forRoot({ isGlobal: true })` ishlatish
3. Bot `long-polling` rejimda ishlasin (keyinroq webhook'ga o'tkazamiz)
4. Prisma `onModuleInit` da `$connect()` qilsin
5. Redis ulanishi `ConfigService` dan olinsin
