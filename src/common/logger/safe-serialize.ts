/** Qiymati logga hech qachon tushmasligi kerak bo'lgan kalitlar. */
const SENSITIVE_KEY = /token|secret|password|passwd|authorization|apikey|api_key|phone|otp/i;

/**
 * Butunlay tashlab yuboriladigan kalitlar.
 *
 * grammY `BotError` ichida `ctx` bo'ladi, uning ichida esa `api.token` (bot
 * tokeni) va `update` (foydalanuvchi yozgan matn — ya'ni SMS kod va telefon
 * raqam) yotadi. Kalit nomi bo'yicha filtr ularni ushlamaydi (`text` maxfiy
 * ko'rinmaydi), shuning uchun butun shox olib tashlanadi.
 */
const DROPPED_KEY = /^(ctx|update|api|payload|request|config|headers)$/i;

const REDACTED = '[redacted]';
const MAX_DEPTH = 4;
const MAX_LENGTH = 2_000;

/**
 * Ixtiyoriy qiymatni logga yozish uchun xavfsiz matnga aylantiradi.
 *
 * Xom `JSON.stringify` ishlatib bo'lmaydi: Nest'ning global exception filtri
 * ushlanmagan xatoni OBYEKT sifatida loggerga uzatadi va webhook rejimida u
 * bot tokeni bilan birga kelardi.
 */
export function safeSerialize(value: unknown, maxLength = MAX_LENGTH): string {
  const seen = new WeakSet<object>();

  const visit = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input !== 'object') {
      return typeof input === 'bigint' ? input.toString() : input;
    }
    if (depth >= MAX_DEPTH) {
      return '[depth-limit]';
    }
    if (seen.has(input)) {
      return '[circular]';
    }
    seen.add(input);

    if (input instanceof Error) {
      return { name: input.name, message: input.message };
    }
    if (Array.isArray(input)) {
      return input.slice(0, 20).map((item) => visit(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) {
      if (DROPPED_KEY.test(key)) {
        continue;
      }
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : visit(item, depth + 1);
    }
    return result;
  };

  let text: string;
  try {
    text = JSON.stringify(visit(value, 0)) ?? String(value);
  } catch {
    text = '[serialization-failed]';
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}…[truncated]` : text;
}
