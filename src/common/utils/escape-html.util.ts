/**
 * Telegram HTML rejimi uchun maxsus belgilarni ekranlaydi.
 * Faqat matn kontekstida ishlatiladi (atribut ichida emas), shuning uchun
 * `&`, `<`, `>` yetarli — Telegram hujjati ham shuni talab qiladi.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
