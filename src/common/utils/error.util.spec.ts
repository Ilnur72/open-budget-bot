import { toErrorInfo } from './error.util';

describe('toErrorInfo', () => {
  it('Error obyektidan message va stack oladi', () => {
    const info = toErrorInfo(new Error('sinov'));
    expect(info.message).toBe('sinov');
    expect(info.stack).toContain('Error: sinov');
  });

  it("Error bo'lmagan qiymatni matnga aylantiradi", () => {
    expect(toErrorInfo('oddiy matn')).toEqual({ message: 'oddiy matn' });
    expect(toErrorInfo({ code: 'P2002' })).toEqual({ message: '[object Object]' });
    expect(toErrorInfo(undefined)).toEqual({ message: 'undefined' });
  });
});
