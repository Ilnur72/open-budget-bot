/**
 * Excel/LibreOffice formula injection'ni to'sadigan boshlang'ich belgilar.
 * Bunday belgi bilan boshlangan katak jadval dasturida FORMULA sifatida
 * bajariladi — masalan `=HYPERLINK(...)` yoki `=cmd|...` bilan admin
 * kompyuterida buyruq ishga tushirilishi mumkin.
 */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Excel UTF-8 ni to'g'ri aniqlashi uchun fayl boshiga qo'yiladigan belgi. */
const UTF8_BOM = '\uFEFF';

/** Bitta katakni CSV uchun xavfsiz ko'rinishga keltiradi. */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  let text = String(value);

  // Formulani zararsizlantirish: oldiga apostrof qo'yiladi, qiymat o'zgarmaydi.
  if (text.length > 0 && FORMULA_PREFIXES.has(text[0])) {
    text = `'${text}`;
  }

  // Qo'shtirnoq ikkilantiriladi, katak har doim qo'shtirnoqqa olinadi.
  return `"${text.replace(/"/g, '""')}"`;
}

/** Sarlavha va qatorlardan CSV matnini yig'adi. */
export function buildCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }

  // BOM — Excel UTF-8 ni to'g'ri o'qishi uchun (o'zbekcha harflar buzilmasin).
  // CRLF — Excel uchun standart qator ajratgichi.
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/** Bitta CSV qatorini yig'adi (bo'laklab yozish uchun). */
export function buildCsvRow(cells: (string | number | null)[]): string {
  return `${cells.map(escapeCsvCell).join(',')}\r\n`;
}

/** Sarlavha qatorini BOM bilan yig'adi. */
export function buildCsvHeader(headers: string[]): string {
  return `${UTF8_BOM}${buildCsvRow(headers)}`;
}
