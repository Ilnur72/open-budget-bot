import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { Context } from 'grammy';

/**
 * Tashqi middleware konteksti.
 *
 * `session()` middleware ATAYLAB ishlatilmaydi: `ctx.session` hech qayerda
 * kerak emas, conversations v2 esa o'z storage'iga ega. Ikkalasi birga
 * turganda ular bir xil Redis kalitiga (`String(ctx.chatId)`, prefikssiz)
 * yozib, bir-birining holatini o'chirar edi.
 */
export type BotContext = ConversationFlavor<Context>;

/** Conversation ichidagi kontekst — bu yerda `ctx.conversation` mavjud emas. */
export type ConversationContext = Context;

/** Conversation builder'ga uzatiladigan boshqaruv obyekti. */
export type BotConversation = Conversation<BotContext, ConversationContext>;
