import { VoteStatus } from '@prisma/client';
import { formatVoteStatus } from './bot.messages';

describe('formatVoteStatus', () => {
  it('barcha holatlar uchun matn beradi', () => {
    for (const status of Object.values(VoteStatus)) {
      expect(formatVoteStatus(status).length).toBeGreaterThan(0);
    }
  });
});
