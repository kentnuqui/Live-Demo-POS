/** Today's calendar date in an IANA timezone, as YYYY-MM-DD. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

/**
 * Inclusive start and exclusive end of a calendar day in a timezone.
 * The two passes correct the offset when the guess lands on the other side of a DST change.
 */
export function zonedDayRange(day: string, timeZone: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error('Invalid day')
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, date))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== date) {
    throw new Error('Invalid day')
  }
  const next = new Date(probe)
  next.setUTCDate(next.getUTCDate() + 1)
  return {
    start: zonedMidnight(year, month, date, timeZone),
    end: zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)
  }
}

function zonedMidnight(year: number, month: number, date: number, timeZone: string): Date {
  const utcGuess = Date.UTC(year, month - 1, date, 0, 0, 0)
  let instant = utcGuess
  for (let pass = 0; pass < 3; pass += 1) {
    instant = utcGuess - offsetMs(new Date(instant), timeZone)
  }
  return new Date(instant)
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(instant)
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second'))
  return asUtc - instant.getTime()
}
