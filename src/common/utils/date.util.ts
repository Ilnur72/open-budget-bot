/** Sanani berilgan vaqt mintaqasidagi kalendar bo'laklariga ajratadi. */
function zonedParts(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value ?? '0');

  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    // Ba'zi ICU versiyalarida yarim tun "24" bo'lib keladi.
    hour: part('hour') % 24,
    minute: part('minute'),
    second: part('second'),
  };
}

/** IANA vaqt mintaqasidagi lokal vaqt bilan UTC orasidagi farq (millisekundda). */
function timeZoneOffsetMs(timeZone: string, date: Date): number {
  const { year, month, day, hour, minute, second } = zonedParts(timeZone, date);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // `asUtc` da millisekund yo'q — solishtirishdan oldin uni `date` dan ham
  // olib tashlaymiz, aks holda ms offsetga "oqib" kirib natijani siljitadi.
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

/**
 * Berilgan vaqt mintaqasidagi joriy kun boshini qaytaradi.
 * Server UTC'da ishlasa ham (Docker'da odatiy hol) "bugungi" statistika
 * O'zbekiston kuni bo'yicha to'g'ri hisoblanadi.
 */
export function startOfDayInTimeZone(timeZone: string, now: Date = new Date()): Date {
  const { year, month, day } = zonedParts(timeZone, now);
  const localMidnightUtc = Date.UTC(year, month - 1, day);

  // Ikki bosqich: avval `now` paytidagi offset bilan taxmin qilamiz, so'ng
  // offsetni yarim tun atrofida qayta o'lchaymiz. DST o'tish kunida offset
  // kun ichida o'zgaradi va bir bosqichli hisob 1 soatga adashadi.
  const guess = new Date(localMidnightUtc - timeZoneOffsetMs(timeZone, now));
  return new Date(localMidnightUtc - timeZoneOffsetMs(timeZone, guess));
}
