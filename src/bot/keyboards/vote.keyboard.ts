import { InlineKeyboard, Keyboard } from 'grammy';

/** Ovoz berish oqimini boshlash tugmasi. */
export const VOTE_START_CALLBACK = 'vote:start';

/** Oqim boshidagi tasdiqlash tugmalari. */
export const VOTE_CONFIRM_CALLBACK = 'vote:confirm';
export const VOTE_CANCEL_CALLBACK = 'vote:cancel';

/** Telefon so'ralganda ko'rsatiladigan bekor qilish matni. */
export const CANCEL_BUTTON_TEXT = '❌ Bekor qilish';

/**
 * Asosiy menyu.
 *
 * Birinchi tugma — rasmiy `@ochiqbudjetbot` ga to'g'ridan-to'g'ri havola:
 * u yerda captcha ham, SMS ham talab qilinmaydi, chunki Telegram shaxsni
 * o'zi tasdiqlaydi. Bu ko'pchilik uchun eng oson yo'l.
 *
 * Ikkinchi tugma — bizning SMS oqimimiz. U faqat Telegram akkauntidagidan
 * BOSHQA raqam bilan ovoz bermoqchi bo'lganlar uchun kerak.
 */
export function buildMainKeyboard(officialBotUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url('⚡️ Tez ovoz berish (captchasiz)', officialBotUrl)
    .row()
    .text('📱 Boshqa raqam bilan (SMS)', VOTE_START_CALLBACK);
}

/** Rasmiy botga deep-link yasaydi. */
export function buildOfficialBotUrl(botUsername: string, publicId: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(publicId)}`;
}

/** Oqimni boshlashdan oldingi tasdiqlash. */
export function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Davom etish', VOTE_CONFIRM_CALLBACK)
    .row()
    .text(CANCEL_BUTTON_TEXT, VOTE_CANCEL_CALLBACK);
}

/**
 * Captcha Mini App'ni ochadigan tugma.
 *
 * MAJBURIY reply keyboard: `web_app_data` service xabarini faqat shu tur
 * tugmadan ochilgan Mini App yubora oladi. Inline tugmadan ochilgani
 * `answerWebAppQuery` orqali javob beradi va `waitFor('message:web_app_data')`
 * hech qachon rezolv bo'lmasdi.
 */
export function buildCaptchaKeyboard(webappUrl: string): Keyboard {
  return new Keyboard().webApp('🧩 Captcha yechish', webappUrl).resized().oneTime();
}

/** Telefon raqamni Telegram kontakti orqali so'rash klaviaturasi. */
export function buildPhoneRequestKeyboard(): Keyboard {
  return new Keyboard()
    .requestContact('📞 Raqamimni yuborish')
    .row()
    .text(CANCEL_BUTTON_TEXT)
    .resized()
    .oneTime();
}
