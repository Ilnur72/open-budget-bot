import { buildMainKeyboard, buildOfficialBotUrl } from './vote.keyboard';

describe('buildOfficialBotUrl', () => {
  it('rasmiy botga deep-link yasaydi', () => {
    expect(buildOfficialBotUrl('ochiqbudjetbot', '055501602005')).toBe(
      'https://t.me/ochiqbudjetbot?start=055501602005',
    );
  });

  it('parametrni ekranlaydi', () => {
    expect(buildOfficialBotUrl('bot', 'a b&c')).toBe('https://t.me/bot?start=a%20b%26c');
  });
});

describe('buildMainKeyboard', () => {
  it("birinchi tugma — captchasiz rasmiy yo'l", () => {
    const markup = buildMainKeyboard('https://t.me/x?start=1').inline_keyboard;

    // Eng oson yo'l birinchi bo'lishi kerak — ko'pchilik shuni bosadi.
    expect(markup[0][0]).toMatchObject({ url: 'https://t.me/x?start=1' });
    expect(markup[0][0].text).toContain('captchasiz');
  });

  it('ikkinchi tugma — SMS oqimi', () => {
    const markup = buildMainKeyboard('https://t.me/x?start=1').inline_keyboard;

    expect(markup[1][0]).toMatchObject({ callback_data: 'vote:start' });
  });
});
