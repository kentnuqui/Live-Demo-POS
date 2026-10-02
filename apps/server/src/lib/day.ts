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
  const match = parseDay(day)
  const next = parseDay(shiftDay(day, 1))
  return {
    start: zonedMidnight(match.year, match.month, match.date, timeZone),
    end: zonedMidnight(next.year, next.month, next.date, timeZone)
  }
}

/** Shifts a YYYY-MM-DD calendar date by a number of days. */
export function shiftDay(day: string, days: number): string {
  const match = parseDay(day)
  const probe = new Date(Date.UTC(match.year, match.month - 1, match.date))
  probe.setUTCDate(probe.getUTCDate() + days)
  return formatDay(probe)
}

/** Monday of the calendar week that contains `day`. */
export function startOfWeek(day: string): string {
  const match = parseDay(day)
  const probe = new Date(Date.UTC(match.year, match.month - 1, match.date))
  const weekday = probe.getUTCDay()
  const delta = weekday === 0 ? 6 : weekday - 1
  return shiftDay(day, -delta)
}

/** First calendar day of the month that contains `day`. */
export function startOfMonth(day: string): string {
  const match = parseDay(day)
  return `${String(match.year).padStart(4, '0')}-${String(match.month).padStart(2, '0')}-01`
}

function parseDay(day: string): { year: number; month: number; date: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error('Invalid day')
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, date))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== date) {
    throw new Error('Invalid day')
  }
  return { year, month, date }
}

function formatDay(probe: Date): string {
  const month = String(probe.getUTCMonth() + 1).padStart(2, '0')
  const date = String(probe.getUTCDate()).padStart(2, '0')
  return `${probe.getUTCFullYear()}-${month}-${date}`
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
