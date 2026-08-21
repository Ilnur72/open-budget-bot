/** Nest Logger `error(message, stack)` ko'rinishida kutadi — shuning uchun ikkalasini ajratamiz. */
export interface ErrorInfo {
  message: string;
  stack?: string;
}

/**
 * `unknown` tipdagi xatolikni xavfsiz o'qiladigan ko'rinishga keltiradi.
 * Prisma/pg/grammY har doim ham `Error` tashlamaydi — string yoki obyekt kelishi mumkin.
 */
export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
