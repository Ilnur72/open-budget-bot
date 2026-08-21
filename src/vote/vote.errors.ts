/**
 * Bu telefon raqam ushbu tashabbusga allaqachon muvaffaqiyatli ovoz bergan.
 * DB'dagi qisman unikal indeks (`votes_initiative_phone_success_key`) tomonidan aniqlanadi.
 */
export class DuplicateVoteError extends Error {
  constructor(readonly initiativeUuid: string) {
    super('Bu telefon raqam ushbu tashabbusga allaqachon ovoz bergan');
    this.name = 'DuplicateVoteError';
  }
}

/** Telefon raqam `+998XXXXXXXXX` formatiga keltirib bo'lmaydi. */
export class InvalidPhoneError extends Error {
  /** @param maskedPhone loglarga tushishi mumkin — shuning uchun maskalangan holda saqlanadi */
  constructor(readonly maskedPhone: string) {
    super("Telefon raqam noto'g'ri formatda");
    this.name = 'InvalidPhoneError';
  }
}

/** Berilgan ID bo'yicha ovoz yozuvi topilmadi (Prisma P2025). */
export class VoteNotFoundError extends Error {
  constructor(readonly voteId: number) {
    super(`Ovoz yozuvi topilmadi: id=${voteId}`);
    this.name = 'VoteNotFoundError';
  }
}
