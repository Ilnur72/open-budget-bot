/** Telefon raqamning o'rta qismini yashiradi — loglarda shaxsiy ma'lumot chiqmasligi uchun. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) {
    return '***';
  }
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}
