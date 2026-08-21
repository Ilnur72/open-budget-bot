# 04 — Telegram Bot Moduli va Conversation Flow

## Vazifa

grammY bilan Telegram bot yarat. Foydalanuvchi step-by-step ovoz berish jarayonidan o'tadi.

## Bot buyruqlari:

| Buyruq | Vazifasi |
|--------|----------|
| `/start` | Salomlashish, bot haqida ma'lumot |
| `/vote` | Ovoz berish jarayonini boshlash |
| `/status` | Ovozlar holati (foydalanuvchi uchun) |
| `/help` | Yordam |
| `/admin` | Admin panel (faqat adminlar uchun) |

## Conversation Flow (`vote.conversation.ts`):

```typescript
// src/bot/conversations/vote.conversation.ts
import { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import { Context } from 'grammy';

type MyContext = Context & ConversationFlavor;

export async function voteConversation(
  conversation: Conversation<MyContext>,
  ctx: MyContext,
) {
  // === 1-qadam: Salomlashish va tushuntirish ===
  await ctx.reply(
    '🗳 *Ochiq Byudjet — Ovoz berish*\n\n' +
    '📍 Mahalla loyihasi uchun ovoz berasiz.\n' +
    'Jarayon:\n' +
    '1️⃣ Captcha yechish\n' +
    '2️⃣ Telefon raqam kiritish\n' +
    '3️⃣ SMS kodni tasdiqlash\n\n' +
    'Davom etamizmi?',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Davom etish', callback_data: 'start_vote' }],
          [{ text: '❌ Bekor qilish', callback_data: 'cancel' }],
        ],
      },
    },
  );

  const startResponse = await conversation.waitForCallbackQuery([
    'start_vote',
    'cancel',
  ]);

  if (startResponse.match === 'cancel') {
    await startResponse.answerCallbackQuery();
    await ctx.reply('Bekor qilindi.');
    return;
  }
  await startResponse.answerCallbackQuery();

  // === 2-qadam: Captcha ===
  // OpenBudgetService orqali captcha olish
  const openBudgetService = conversation.external(() => {
    // NestJS DI orqali servisni olish
    return ctx.api; // placeholder — haqiqiy kodda DI ishlatiladi
  });

  await ctx.reply(
    '🔐 *Captcha yechish*\n\n' +
    'Quyidagi tugmani bosib, captchani yeching.\n' +
    'Captcha yechilgandan keyin avtomatik davom etadi.',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🧩 Captcha yechish',
              web_app: {
                url: `${process.env.WEBAPP_URL}?initiative=${process.env.INITIATIVE_UUID}`,
              },
            },
          ],
        ],
      },
    },
  );

  // WebApp dan natija kutish
  const webAppData = await conversation.waitFor('message:web_app_data');
  const captchaResult = JSON.parse(webAppData.message.web_app_data.data);

  await ctx.reply('✅ Captcha yechildi!');

  // === 3-qadam: Telefon raqam ===
  await ctx.reply(
    '📱 *Telefon raqamingizni kiriting:*\n\n' +
    'Masalan: `998901234567` yoki `+998901234567`\n\n' +
    'Yoki kontaktingizni ulashing:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📞 Raqamni ulashish', request_contact: true }],
          [{ text: '❌ Bekor qilish' }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    },
  );

  let phoneNumber: string;

  const phoneResponse = await conversation.wait();

  if (phoneResponse.message?.contact) {
    phoneNumber = phoneResponse.message.contact.phone_number;
  } else if (phoneResponse.message?.text) {
    if (phoneResponse.message.text === '❌ Bekor qilish') {
      await ctx.reply('Bekor qilindi.', {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }
    phoneNumber = phoneResponse.message.text;
  } else {
    await ctx.reply('❌ Noto\'g\'ri format. Qaytadan urinib ko\'ring: /vote');
    return;
  }

  // Telefon raqamni validatsiya
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  if (cleanPhone.length < 9 || cleanPhone.length > 12) {
    await ctx.reply('❌ Telefon raqam noto\'g\'ri.', {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  await ctx.reply(`📤 Raqamga SMS kod yuborilmoqda: +${cleanPhone}...`, {
    reply_markup: { remove_keyboard: true },
  });

  // OpenBudget API ga yuborish
  // const submitResult = await openBudgetService.submitCaptcha(phoneNumber, captchaResult.points);
  // if (!submitResult.success) { ... }

  // === 4-qadam: OTP kod ===
  await ctx.reply(
    '📩 *SMS kod yuborildi!*\n\n' +
    'Telefoningizga kelgan 4-6 xonali kodni kiriting:',
    { parse_mode: 'Markdown' },
  );

  const otpResponse = await conversation.waitFor('message:text');
  const otpCode = otpResponse.message.text.trim();

  if (!/^\d{4,6}$/.test(otpCode)) {
    await ctx.reply('❌ Kod faqat raqamlardan iborat bo\'lishi kerak (4-6 xona).');
    return;
  }

  await ctx.reply('⏳ Ovoz tasdiqlanmoqda...');

  // const verifyResult = await openBudgetService.verifyOtp(otpCode, submitResult.grToken);
  // if (verifyResult.success) { ... }

  // === 5-qadam: Natija ===
  await ctx.reply(
    '🎉 *Ovoz muvaffaqiyatli berildi!*\n\n' +
    '✅ Mahallangiz loyihasi uchun ovozingiz qabul qilindi.\n' +
    'Rahmat! 🙏',
    { parse_mode: 'Markdown' },
  );
}
```

## Bot Service (`bot.service.ts`):

```typescript
// src/bot/bot.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { RedisAdapter } from '@grammyjs/storage-redis';
import Redis from 'ioredis';
import { voteConversation } from './conversations/vote.conversation';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  public bot: Bot;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.bot = new Bot(this.config.get('BOT_TOKEN'));

    // Redis session
    const redis = new Redis(this.config.get('REDIS_URL'));
    this.bot.use(
      session({
        initial: () => ({}),
        storage: new RedisAdapter({ instance: redis }),
      }),
    );

    // Conversations plugin
    this.bot.use(conversations());
    this.bot.use(createConversation(voteConversation));

    // Commands
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        '👋 *Salom!*\n\n' +
        '🗳 Men Ochiq Byudjet ovoz berish botiman.\n' +
        'Mahallangiz loyihasiga ovoz berish uchun /vote buyrug\'ini bering.\n\n' +
        '📋 Buyruqlar:\n' +
        '/vote — Ovoz berish\n' +
        '/status — Ovozlaringiz holati\n' +
        '/help — Yordam',
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('vote', async (ctx) => {
      await ctx.conversation.enter('voteConversation');
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '❓ *Yordam*\n\n' +
        'Ovoz berish uchun:\n' +
        '1. /vote buyrug\'ini bering\n' +
        '2. Captchani yeching\n' +
        '3. Telefon raqamingizni kiriting\n' +
        '4. SMS kodni tasdiqlang\n\n' +
        'Muammo bo\'lsa: @admin_username',
        { parse_mode: 'Markdown' },
      );
    });

    // Bot'ni ishga tushirish
    this.bot.start({
      onStart: () => this.logger.log('Bot ishga tushdi!'),
    });
  }
}
```

## Talablar:

1. `grammY` conversations pluginini to'g'ri sozla (session + conversations middleware ketma-ketligi muhim!)
2. Har bir foydalanuvchi uchun alohida session Redis'da saqlansin
3. Conversation timeout: 5 daqiqa — shu vaqt ichida javob kelmasa, avtomatik bekor bo'lsin
4. Har bir ovoz berish urinishi `VoteLog` jadvaliga yozilsin
5. Xatoliklar foydalanuvchiga tushunarli tilda ko'rsatilsin (o'zbekcha)
6. Contact share qilinganda telefon raqamni avtomatik olish
