import { VoteStatus } from '@prisma/client';

/** Ovoz holatini foydalanuvchi uchun belgi bilan yozadi. */
export function formatVoteStatus(status: VoteStatus): string {
  switch (status) {
    case VoteStatus.SUCCESS:
      return '✅ qabul qilindi';
    case VoteStatus.FAILED:
      return '❌ muvaffaqiyatsiz';
    case VoteStatus.VERIFIED:
      return '🔄 tasdiqlanmoqda';
    case VoteStatus.CODE_SENT:
      return '📩 SMS yuborilgan';
    case VoteStatus.CAPTCHA_SENT:
      return '🧩 captcha bosqichida';
    case VoteStatus.PENDING:
      return '⏳ boshlangan';
  }
}
