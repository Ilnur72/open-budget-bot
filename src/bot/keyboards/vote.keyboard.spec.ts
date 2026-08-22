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
  const markup = () => buildMainKeyboard('https://t.me/x?start=1').inline_keyboard;

  it('bitta tugma — rasmiy botga havola', () => {
    expect(markup()).toHaveLength(1);
    expect(markup()[0][0]).toMatchObject({ url: 'https://t.me/x?start=1' });
  });
});
