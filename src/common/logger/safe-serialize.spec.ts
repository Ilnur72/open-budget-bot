import { safeSerialize } from './safe-serialize';

describe('safeSerialize', () => {
  it('oddiy obyektni seriyalashtiradi', () => {
    expect(safeSerialize({ a: 1, b: 'salom' })).toBe('{"a":1,"b":"salom"}');
  });

  describe('maxfiy kalitlarni yashiradi', () => {
    it.each(['token', 'secret', 'password', 'authorization', 'apiKey', 'phone', 'otp'])(
      '%s -> [redacted]',
      (key) => {
        const result = safeSerialize({ [key]: 'MAXFIY-QIYMAT' });

        expect(result).not.toContain('MAXFIY-QIYMAT');
        expect(result).toContain('[redacted]');
      },
    );

    it("katta-kichik harfdan qat'i nazar ishlaydi", () => {
      expect(safeSerialize({ BOT_TOKEN: 'X' })).not.toContain('"X"');
      expect(safeSerialize({ PhoneNumber: 'X' })).not.toContain('"X"');
    });
  });

  describe('xavfli shoxlarni butunlay tashlaydi', () => {
    it.each(['ctx', 'update', 'api', 'headers', 'payload'])('%s shoxi olib tashlanadi', (key) => {
      const result = safeSerialize({ message: 'xato', [key]: { text: 'SMS-KOD-654321' } });

      // Kalit nomi bo'yicha filtr `text` ni ushlamaydi — butun shox kerak.
      expect(result).not.toContain('SMS-KOD-654321');
      expect(result).toContain('xato');
    });
  });

  it('grammY BotError shaklidan token va update chiqmaydi', () => {
    const botError = {
      name: 'BotError',
      error: new Error('buzildi'),
      ctx: {
        api: { token: '111111:SECRET' },
        update: { message: { text: '654321', contact: { phone_number: '+998901234567' } } },
      },
    };

    const result = safeSerialize(botError);

    expect(result).not.toContain('SECRET');
    expect(result).not.toContain('654321');
    expect(result).not.toContain('998901234567');
    // Foydali qism saqlanadi.
    expect(result).toContain('buzildi');
  });

  it('aylanma havolada yiqilmaydi', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;

    expect(safeSerialize(node)).toContain('[circular]');
  });

  it('chuqurlikni cheklaydi', () => {
    const deep = { l1: { l2: { l3: { l4: { l5: 'juda chuqur' } } } } };

    const result = safeSerialize(deep);

    expect(result).not.toContain('juda chuqur');
    expect(result).toContain('[depth-limit]');
  });

  it('uzunlikni cheklaydi', () => {
    const result = safeSerialize({ data: 'x'.repeat(5_000) });

    expect(result.length).toBeLessThan(2_100);
    expect(result).toContain('[truncated]');
  });

  it("Error obyektini o'qiladigan holga keltiradi", () => {
    expect(safeSerialize({ cause: new Error('ichki xato') })).toContain('ichki xato');
  });

  it('BigInt bilan yiqilmaydi', () => {
    expect(safeSerialize({ id: 123n })).toBe('{"id":"123"}');
  });

  it('massivni cheklaydi', () => {
    const result = safeSerialize({ items: Array.from({ length: 100 }, (_, i) => i) });

    expect(result).toContain('0,1,2');
    expect(result).not.toContain('99');
  });
});
