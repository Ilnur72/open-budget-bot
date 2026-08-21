import { formatUzPhone, isValidUzPhone } from './phone.util';

describe('formatUzPhone', () => {
  it.each([
    ['+998901234567', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['901234567', '+998901234567'],
    ['+998 90 123 45 67', '+998901234567'],
    ['(90) 123-45-67', '+998901234567'],
    ['+998-90-123-45-67', '+998901234567'],
  ])('%s -> %s', (input, expected) => {
    expect(formatUzPhone(input)).toBe(expected);
  });

  it("Telegram kontakti va qo'lda kiritilgan raqam bir xil natija beradi", () => {
    // Aynan shu farq dublikat himoyasini chetlab o'tishga sabab bo'lardi.
    expect(formatUzPhone('998901234567')).toBe(formatUzPhone('+998901234567'));
  });
});

describe('isValidUzPhone', () => {
  it.each(['+998901234567', '998901234567', '901234567', '+998 90 123 45 67'])(
    '%s -> haqiqiy',
    (input) => {
      expect(isValidUzPhone(input)).toBe(true);
    },
  );

  it.each([
    ['', "bo'sh satr"],
    ['abcdefghij', 'faqat harflar'],
    ['9012345', 'juda qisqa'],
    ['90123456789', 'juda uzun'],
    ['+7 999 123 45 67', 'boshqa davlat kodi'],
  ])('%s (%s) -> yaroqsiz', (input) => {
    expect(isValidUzPhone(input)).toBe(false);
  });
});
