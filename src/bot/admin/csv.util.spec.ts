import { buildCsv, escapeCsvCell } from './csv.util';

describe('escapeCsvCell', () => {
  it("oddiy qiymatni qo'shtirnoqqa oladi", () => {
    expect(escapeCsvCell('salom')).toBe('"salom"');
    expect(escapeCsvCell(42)).toBe('"42"');
  });

  it("bo'sh qiymatlarni bo'sh satrga aylantiradi", () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it("qo'shtirnoqni ikkilantiradi", () => {
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });

  it('vergul va qator uzilishini saqlaydi', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });

  describe('formula injection', () => {
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '=HYPERLINK("http://x")', '=cmd|calc'])(
      '%s ni zararsizlantiradi',
      (payload) => {
        const cell = escapeCsvCell(payload);

        // Apostrof qo'shilishi kerak — aks holda Excel uni formula deb bajarardi.
        expect(cell).toBe(`"'${payload.replace(/"/g, '""')}"`);
      },
    );

    it('+998 bilan boshlangan telefonni ham himoyalaydi', () => {
      // `+998...` Excel uchun formula boshlanishi — bu real holat.
      expect(escapeCsvCell('+998901234567')).toBe(`"'+998901234567"`);
    });
  });
});

describe('buildCsv', () => {
  it("BOM, CRLF va sarlavha bilan yig'adi", () => {
    const csv = buildCsv(
      ['id', 'nom'],
      [
        [1, 'Ali'],
        [2, 'Vali'],
      ],
    );

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFF"id","nom"\r\n"1","Ali"\r\n"2","Vali"\r\n');
  });

  it('qatorsiz ham ishlaydi', () => {
    expect(buildCsv(['a'], [])).toBe('\uFEFF"a"\r\n');
  });
});
