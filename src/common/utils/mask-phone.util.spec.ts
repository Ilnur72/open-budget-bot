import { maskPhone } from './mask-phone.util';

describe('maskPhone', () => {
  it("to'liq raqamning o'rtasini yashiradi", () => {
    expect(maskPhone('+998901234567')).toBe('+998***567');
  });

  it('juda qisqa qiymatni butunlay yashiradi', () => {
    expect(maskPhone('12345')).toBe('***');
    expect(maskPhone('')).toBe('***');
  });
});
