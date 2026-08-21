import { enterConversation, resumeConversation } from '@grammyjs/conversations';
import type { ConversationState } from '@grammyjs/conversations';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { BotContext, ConversationContext } from '../bot.types';
import type { VoteFlowService } from '../vote-flow.service';
import { createVoteConversation } from './vote.conversation';

/**
 * Conversation'ni grammY'ning haqiqiy dvigateli bilan ishga tushiradigan test.
 *
 * Nima uchun mock yetarli emas: conversations v2 ning ikkita nozik jihati
 * faqat real ijroda ko'rinadi —
 *   1. `external()` natijasi `structuredClone` dan o'tadi (Error tiplari yo'qoladi);
 *   2. holat Redis'ga JSON bo'lib yozilib, replay paytida qayta o'qiladi.
 * Har bir qadam orasida holat JSON round-trip qilinadi — replay divergensiyasi
 * shu yerda ushlanadi.
 */

const ME = { id: 1, is_bot: true, first_name: 'Bot', username: 'test_bot' } as UserFromGetMe;
const API = { token: 'test', options: {} };
const CHAT = { id: 555, type: 'private' as const, first_name: 'Ali' };
const FROM = { id: 555, is_bot: false, first_name: 'Ali' };

/** Sayt aynan 2 ta nuqta kutadi. */
const TWO_POINTS = '{"points":[{"x":1,"y":2},{"x":3,"y":4}]}';

let updateId = 0;
const message = (fields: Record<string, unknown>): Update => ({
  update_id: ++updateId,
  message: { message_id: ++updateId, date: 0, chat: CHAT, from: FROM, ...fields },
});

const callback = (data: string): Update => ({
  update_id: ++updateId,
  callback_query: {
    id: String(++updateId),
    from: FROM,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat: CHAT },
  },
});

/** Yuborilgan xabarlarni yig'adigan soxta Api. */
const sent: string[] = [];
const apiTransformer = ((_prev: unknown, method: string, payload: Record<string, unknown>) => {
  if (method === 'sendMessage' && typeof payload.text === 'string') {
    sent.push(payload.text);
  }
  return Promise.resolve({ ok: true, result: { message_id: 1, date: 0, chat: CHAT } });
}) as never;

const buildFlow = (overrides: Partial<VoteFlowService> = {}) =>
  ({
    prepareCaptcha: jest.fn().mockResolvedValue({ ok: true, value: null }),
    sendCode: jest.fn().mockResolvedValue({ ok: true, value: { voteId: 7, userId: 3 } }),
    confirmOtp: jest.fn().mockResolvedValue({ ok: true, value: null }),
    cancel: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as VoteFlowService;

/** Holatni Redis'dagidek JSON orqali o'tkazadi. */
const roundTrip = (state: ConversationState): ConversationState =>
  JSON.parse(JSON.stringify(state)) as ConversationState;

describe('voteConversation (grammY dvigateli bilan)', () => {
  const options = {
    ctx: { api: API } as unknown as BotContext,
    plugins: [
      async (ctx: ConversationContext, next: () => Promise<void>) => {
        ctx.api.config.use(apiTransformer);
        await next();
      },
    ],
  };

  beforeEach(() => {
    sent.length = 0;
    updateId = 0;
  });

  it("to'liq oqim: tasdiqlash → telefon → captcha → OTP → natija", async () => {
    const voteFlow = buildFlow();
    const conversation = createVoteConversation({ voteFlow, webappUrl: 'https://x.uz/w' });

    let result = await enterConversation(
      conversation,
      {
        update: message({ text: '/vote' }),
        api: API,
        me: ME,
      },
      options,
    );
    expect(result.status).toBe('handled');

    const steps: Update[] = [
      callback('vote:confirm'),
      // Telefon captchadan OLDIN — captcha atigi 30 soniya yashaydi.
      message({ contact: { phone_number: '998901234567', first_name: 'Ali', user_id: 555 } }),
      message({ web_app_data: { button_text: 'c', data: TWO_POINTS } }),
      message({ text: '123456' }),
    ];

    for (const update of steps) {
      if (result.status !== 'handled') {
        break;
      }
      const state = roundTrip({ replay: result.replay, interrupts: result.interrupts });
      result = (await resumeConversation(
        conversation,
        { update, api: API, me: ME },
        state,
        options,
      )) as typeof result;
    }

    expect(result.status).toBe('complete');
    expect(voteFlow.sendCode).toHaveBeenCalledWith(
      555,
      expect.objectContaining({ firstName: 'Ali' }),
      '998901234567',
      'contact',
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    );
    expect(voteFlow.confirmOtp).toHaveBeenCalledWith(555, { voteId: 7, userId: 3 }, '123456');
    expect(sent.at(-1)).toContain('Ovoz muvaffaqiyatli berildi');
  });

  it("noto'g'ri OTP dan keyin QAYTA so'raydi — structuredClone kodni buzmasligi kerak", async () => {
    const voteFlow = buildFlow({
      confirmOtp: jest
        .fn()
        .mockResolvedValueOnce({ ok: false, failure: { code: 'INVALID_OTP' } })
        .mockResolvedValueOnce({ ok: true, value: null }),
    });
    const conversation = createVoteConversation({ voteFlow, webappUrl: 'https://x.uz/w' });

    let result = await enterConversation(
      conversation,
      {
        update: message({ text: '/vote' }),
        api: API,
        me: ME,
      },
      options,
    );

    const steps: Update[] = [
      callback('vote:confirm'),
      message({ contact: { phone_number: '998901234567', first_name: 'Ali', user_id: 555 } }),
      message({ web_app_data: { button_text: 'c', data: TWO_POINTS } }),
      message({ text: '000000' }),
      message({ text: '123456' }),
    ];

    for (const update of steps) {
      if (result.status !== 'handled') {
        break;
      }
      const state = roundTrip({ replay: result.replay, interrupts: result.interrupts });
      result = (await resumeConversation(
        conversation,
        { update, api: API, me: ME },
        state,
        options,
      )) as typeof result;
    }

    expect(result.status).toBe('complete');
    expect(voteFlow.confirmOtp).toHaveBeenCalledTimes(2);
    expect(sent).toContainEqual(expect.stringContaining("Kod noto'g'ri"));
    expect(sent.at(-1)).toContain('Ovoz muvaffaqiyatli berildi');
  });

  it('boshqa odamning kontakti rad etiladi', async () => {
    const voteFlow = buildFlow();
    const conversation = createVoteConversation({ voteFlow, webappUrl: 'https://x.uz/w' });

    let result = await enterConversation(
      conversation,
      {
        update: message({ text: '/vote' }),
        api: API,
        me: ME,
      },
      options,
    );

    const steps: Update[] = [
      callback('vote:confirm'),
      // user_id boshqa odamniki — manzillar kitobidan yuborilgan kontakt.
      message({ contact: { phone_number: '998900000000', first_name: 'Vali', user_id: 999 } }),
    ];

    for (const update of steps) {
      if (result.status !== 'handled') {
        break;
      }
      const state = roundTrip({ replay: result.replay, interrupts: result.interrupts });
      result = (await resumeConversation(
        conversation,
        { update, api: API, me: ME },
        state,
        options,
      )) as typeof result;
    }

    expect(voteFlow.sendCode).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.stringContaining("o'zingizning raqamingizni"));
  });

  it("bekor qilish tugmasi oqimni to'xtatadi", async () => {
    const voteFlow = buildFlow();
    const conversation = createVoteConversation({ voteFlow, webappUrl: 'https://x.uz/w' });

    let result = await enterConversation(
      conversation,
      {
        update: message({ text: '/vote' }),
        api: API,
        me: ME,
      },
      options,
    );

    if (result.status === 'handled') {
      const state = roundTrip({ replay: result.replay, interrupts: result.interrupts });
      result = (await resumeConversation(
        conversation,
        { update: callback('vote:cancel'), api: API, me: ME },
        state,
        options,
      )) as typeof result;
    }

    expect(result.status).toBe('complete');
    expect(voteFlow.prepareCaptcha).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain('Bekor qilindi');
  });
  it("qo'lda kiritilgan raqam 'manual' deb belgilanadi", async () => {
    const voteFlow = buildFlow();
    const conversation = createVoteConversation({ voteFlow, webappUrl: 'https://x.uz/w' });

    let result = await enterConversation(
      conversation,
      { update: message({ text: '/vote' }), api: API, me: ME },
      options,
    );

    const steps: Update[] = [
      callback('vote:confirm'),
      message({ text: '901234567' }),
      message({ web_app_data: { button_text: 'c', data: TWO_POINTS } }),
      message({ text: '123456' }),
    ];

    for (const update of steps) {
      if (result.status !== 'handled') {
        break;
      }
      const state = roundTrip({ replay: result.replay, interrupts: result.interrupts });
      result = (await resumeConversation(
        conversation,
        { update, api: API, me: ME },
        state,
        options,
      )) as typeof result;
    }

    expect(voteFlow.sendCode).toHaveBeenCalledWith(555, expect.anything(), '901234567', 'manual', [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});
