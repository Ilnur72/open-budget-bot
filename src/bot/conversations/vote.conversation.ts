import type { ConversationBuilder } from '@grammyjs/conversations';
import { REQUIRED_CAPTCHA_POINTS } from '../../openbudget/openbudget.endpoints';
import type { CaptchaPoint } from '../../openbudget/openbudget.types';
import type { PhoneSource } from '../../openbudget/vote-rate-limiter.service';
import type { TelegramProfile } from '../../user/user.service';
import { toUserMessage } from '../bot.messages';
import type { BotContext, BotConversation, ConversationContext } from '../bot.types';
import { isRetryableOtpFailure } from '../flow-result';
import {
  CANCEL_BUTTON_TEXT,
  VOTE_CANCEL_CALLBACK,
  VOTE_CONFIRM_CALLBACK,
  buildCaptchaKeyboard,
  buildConfirmKeyboard,
  buildPhoneRequestKeyboard,
} from '../keyboards/vote.keyboard';
import type { VoteFlowService, VoteRef } from '../vote-flow.service';

/** `ctx.conversation.enter()` uchun identifikator. */
export const VOTE_CONVERSATION_ID = 'vote';

/** Foydalanuvchi javob bermasa oqim shuncha vaqtdan keyin bekor bo'ladi. */
export const VOTE_CONVERSATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Bir qadamda nechta noto'g'ri javob qabul qilinadi.
 * Chegara MAJBURIY: har bir `wait()` to'liq update JSON'ini replay log'ga
 * qo'shadi, cheksiz sikl esa bitta Redis kalitini cheksiz o'stirardi.
 */
const MAX_STEP_ATTEMPTS = 5;

/** Conversation ishlashi uchun kerakli bog'liqliklar. */
export interface VoteConversationDeps {
  voteFlow: VoteFlowService;
  webappUrl: string;
}

/**
 * Ovoz berish oqimi: tasdiqlash → captcha → telefon → SMS kod → natija.
 *
 * NestJS DI conversation ichiga closure orqali kiritiladi (grammY conversation
 * builder'ni o'zi yaratmaydi, shuning uchun konstruktor injection ishlamaydi).
 *
 * Barcha yon ta'sirlar `conversation.external()` ichida bajariladi va u yerdan
 * faqat oddiy obyektlar qaytariladi: `gr_token` va SMS kod replay log'iga
 * tushmasligi kerak, `Error` merosxo'rlari esa `structuredClone` dan omon chiqmaydi.
 */
export function createVoteConversation(
  deps: VoteConversationDeps,
): ConversationBuilder<BotContext, ConversationContext> {
  return async (conversation, ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId === undefined) {
      await ctx.reply('❌ Foydalanuvchi aniqlanmadi.');
      return;
    }

    const profile: TelegramProfile = {
      firstName: ctx.from?.first_name ?? null,
      lastName: ctx.from?.last_name ?? null,
      username: ctx.from?.username ?? null,
    };

    // ---- 1-qadam: tushuntirish va tasdiqlash ----
    await ctx.reply(
      '🗳 <b>SMS orqali ovoz berish</b>\n\n' +
        '📍 Mahalla loyihasi uchun ovoz berasiz.\n\n' +
        'Jarayon:\n' +
        '1️⃣ Telefon raqam kiritish\n' +
        '2️⃣ Captcha yechish (30 soniya)\n' +
        '3️⃣ SMS kodni tasdiqlash\n\n' +
        '💡 <i>Agar Telegram akkauntingizdagi raqam bilan ovoz bermoqchi ' +
        'bo\'lsangiz, /start dagi "⚡️ Tez ovoz berish" tugmasi ancha oson — ' +
        'u yerda captcha ham, SMS ham kerak emas.</i>\n\n' +
        'Davom etamizmi?',
      { parse_mode: 'HTML', reply_markup: buildConfirmKeyboard() },
    );

    // `next: true` — mos kelmagan update downstream'ga o'tsin, aks holda
    // `/cancel` va boshqa buyruqlar jimgina yutilardi.
    const choice = await conversation.waitForCallbackQuery(
      [VOTE_CONFIRM_CALLBACK, VOTE_CANCEL_CALLBACK],
      {
        next: true,
        otherwise: (other) =>
          other.reply('Yuqoridagi tugmalardan birini bosing yoki /cancel yozing.'),
      },
    );
    await choice.answerCallbackQuery();

    if (choice.callbackQuery.data === VOTE_CANCEL_CALLBACK) {
      await ctx.reply('Bekor qilindi. Qaytadan boshlash uchun /vote');
      return;
    }

    // ---- 2-qadam: telefon raqam ----
    //
    // Captchadan OLDIN so'raladi: openbudget.uz captchasi atigi 30 soniya
    // yashaydi (sahifadagi `let t = 30000`). Avval captcha ko'rsatib, keyin
    // telefon so'rasak, oqim bu oynaga hech qachon sig'masdi.
    await ctx.reply(
      '📱 <b>Telefon raqamingizni kiriting</b>\n\n' +
        'Namuna: <code>901234567</code>\n\n' +
        "Yoki pastdagi tugma bilan o'z kontaktingizni yuboring.\n" +
        "<i>Qo'lda kiritish kuniga 1 ta raqam bilan cheklangan.</i>",
      { parse_mode: 'HTML', reply_markup: buildPhoneRequestKeyboard() },
    );

    const phone = await askPhone(conversation, ctx, telegramId);
    if (phone === null) {
      return;
    }

    // ---- 3-qadam: captcha ----
    // Shu nuqtadan boshlab 30 soniyalik oyna ketadi.
    const captcha = await conversation.external(() => deps.voteFlow.prepareCaptcha(telegramId));
    if (!captcha.ok) {
      await ctx.reply(toUserMessage(captcha.failure), { parse_mode: 'HTML' });
      return;
    }

    await ctx.reply(
      '🧩 <b>Captcha yechish</b>\n\n' +
        'Quyidagi tugmani bosing.\n' +
        '<b>A</b> rasmdagi harflar juftligini <b>B</b> rasmdan toping va ' +
        '<b>2 ta nuqtani</b> belgilang.\n\n' +
        '⏱ <b>30 soniya</b> vaqtingiz bor — kechiksangiz qaytadan boshlaysiz.',
      { parse_mode: 'HTML', reply_markup: buildCaptchaKeyboard(deps.webappUrl) },
    );

    const webAppCtx = await conversation.waitFor('message:web_app_data', {
      next: true,
      otherwise: (other) =>
        other.reply('Captchani yechish uchun yuqoridagi tugmani bosing yoki /cancel yozing.'),
    });

    const points = parsePoints(webAppCtx.message.web_app_data.data);
    if (points === null) {
      await ctx.reply("❌ Captcha natijasi o'qilmadi. Qaytadan boshlang: /vote", {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    await ctx.reply('✅ Captcha yechildi.');

    await ctx.reply('📤 SMS kod yuborilmoqda...', { reply_markup: { remove_keyboard: true } });

    const sent = await conversation.external(() =>
      deps.voteFlow.sendCode(telegramId, profile, phone.value, phone.source, points),
    );
    if (!sent.ok) {
      await ctx.reply(toUserMessage(sent.failure), { parse_mode: 'HTML' });
      return;
    }

    // ---- 4-qadam: SMS kod ----
    await ctx.reply('📩 <b>SMS kod yuborildi</b>\n\nTelefoningizga kelgan kodni kiriting:', {
      parse_mode: 'HTML',
    });

    const confirmed = await askOtp(conversation, ctx, telegramId, sent.value, deps);
    if (!confirmed) {
      return;
    }

    // ---- 5-qadam: natija ----
    await ctx.reply(
      '🎉 <b>Ovoz muvaffaqiyatli berildi!</b>\n\n' +
        '✅ Mahallangiz loyihasi uchun ovozingiz qabul qilindi.\n' +
        'Rahmat! 🙏',
      { parse_mode: 'HTML' },
    );
  };
}

/**
 * Telefon raqamni so'raydi.
 *
 * Kontakt yuborilsa uning EGASI tekshiriladi. Qo'lda kiritishga ham ruxsat
 * beriladi (spec talabi) — bu holda raqam egaligini tekshirib bo'lmaydi,
 * shuning uchun himoya limitlarga tayanadi: kuniga 3 raqam/foydalanuvchi va
 * 1 SMS/raqam.
 */
async function askPhone(
  conversation: BotConversation,
  ctx: ConversationContext,
  telegramId: number,
): Promise<{ value: string; source: PhoneSource } | null> {
  for (let attempt = 0; attempt < MAX_STEP_ATTEMPTS; attempt++) {
    // Filtrsiz `wait()` barcha update'ni qabul qiladi, shuning uchun `/cancel`
    // shu yerda qo'lda tekshiriladi (`otherwise` faqat filtrlangan waitlarda bor).
    const response = await conversation.wait();
    const message = response.message;

    // Boshqa foydalanuvchi javobini (guruh qoldig'i) qabul qilmaymiz.
    if (response.from?.id !== telegramId) {
      continue;
    }

    if (message?.contact) {
      if (message.contact.user_id !== response.from.id) {
        await ctx.reply(
          "❌ Faqat o'zingizning raqamingizni tugma orqali yuborishingiz mumkin.\n" +
            "Boshqa raqamni qo'lda kiriting yoki /cancel yozing.",
        );
        continue;
      }
      return { value: message.contact.phone_number, source: 'contact' };
    }

    const text = message?.text?.trim();
    if (text === undefined) {
      await ctx.reply('❌ Telefon raqam yuboring yoki /cancel yozing.');
      continue;
    }
    if (text === CANCEL_BUTTON_TEXT || text.startsWith('/cancel')) {
      await ctx.reply('Bekor qilindi. Qaytadan boshlash uchun /vote', {
        reply_markup: { remove_keyboard: true },
      });
      return null;
    }
    if (text.startsWith('/')) {
      await ctx.reply('Iltimos, telefon raqam yuboring yoki /cancel yozing.');
      continue;
    }

    // Qo'lda kiritilgan raqam egaligi tekshirilmaydi — qattiqroq limit ostida.
    return { value: text, source: 'manual' };
  }

  await ctx.reply("❌ Juda ko'p noto'g'ri urinish. Qaytadan boshlang: /vote", {
    reply_markup: { remove_keyboard: true },
  });
  return null;
}

/** SMS kodni so'raydi; kod noto'g'ri bo'lsa urinishlar tugaguncha qayta so'raydi. */
async function askOtp(
  conversation: BotConversation,
  ctx: ConversationContext,
  telegramId: number,
  ref: VoteRef,
  deps: VoteConversationDeps,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_STEP_ATTEMPTS; attempt++) {
    const response = await conversation.waitFor('message:text', {
      next: true,
      otherwise: (other) => other.reply('SMS kodni matn sifatida yuboring yoki /cancel yozing.'),
    });

    if (response.from?.id !== telegramId) {
      continue;
    }

    const otp = response.message.text.trim();
    if (otp.startsWith('/cancel')) {
      await conversation.external(() => deps.voteFlow.cancel(telegramId));
      await ctx.reply('Bekor qilindi. Qaytadan boshlash uchun /vote');
      return false;
    }
    if (otp.startsWith('/')) {
      // Buyruqni SMS kod deb qabul qilsak, urinish bekorga sarflanardi.
      await ctx.reply('SMS kodni yuboring yoki /cancel yozing.');
      continue;
    }

    // Kod maxfiy — chat tarixida qolmasin.
    await response.deleteMessage().catch(() => undefined);
    await ctx.reply('⏳ Ovoz tasdiqlanmoqda...');

    const result = await conversation.external(() =>
      deps.voteFlow.confirmOtp(telegramId, ref, otp),
    );
    if (result.ok) {
      return true;
    }

    await ctx.reply(toUserMessage(result.failure), { parse_mode: 'HTML' });

    if (!isRetryableOtpFailure(result.failure)) {
      await conversation.external(() => deps.voteFlow.cancel(telegramId, 'OTP_FAILED'));
      return false;
    }
  }

  await conversation.external(() => deps.voteFlow.cancel(telegramId, 'OTP_FAILED'));
  await ctx.reply("❌ Juda ko'p urinish. Qaytadan boshlang: /vote");
  return false;
}

/**
 * WebApp'dan kelgan JSON'ni captcha nuqtalariga aylantiradi.
 * WebApp ishonchsiz mijoz — Telegram hujjati ham ochiq aytadi: "a bad client
 * can send arbitrary data in this field".
 */
function parsePoints(raw: string): CaptchaPoint[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const points = (parsed as { points?: unknown })?.points;
  // Sayt AYNAN 2 ta nuqta kutadi (captcha sahifasidagi `const c = 2`).
  if (!Array.isArray(points) || points.length !== REQUIRED_CAPTCHA_POINTS) {
    return null;
  }

  const result: CaptchaPoint[] = [];
  for (const item of points) {
    const { x, y } = (item ?? {}) as { x?: unknown; y?: unknown };
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return null;
    }
    result.push({ x: x as number, y: y as number });
  }
  return result;
}
