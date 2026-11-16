// Single business-day calendar of the system: monday–friday minus holidays. National holidays are
// built in; each office adds its own (municipal, state, Carnaval, recess) — see modules/holidays.
// Dates are handled as UTC days ('YYYY-MM-DD'); the time of day is ignored.

export type HolidaySet = ReadonlySet<string>

const DAY_MS = 24 * 60 * 60 * 1000

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

// Easter Sunday (Meeus/Jones/Butcher algorithm, Gregorian calendar)
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const FIXED_NATIONAL: { md: string; name: string }[] = [
  { md: '01-01', name: 'Confraternização Universal' },
  { md: '04-21', name: 'Tiradentes' },
  { md: '05-01', name: 'Dia do Trabalho' },
  { md: '09-07', name: 'Independência do Brasil' },
  { md: '10-12', name: 'Nossa Senhora Aparecida' },
  { md: '11-02', name: 'Finados' },
  { md: '11-15', name: 'Proclamação da República' },
  { md: '11-20', name: 'Dia Nacional de Zumbi e da Consciência Negra' },
  { md: '12-25', name: 'Natal' },
]

export function nationalHolidaysWithNames(year: number): { date: string; name: string }[] {
  const goodFriday = new Date(easterSunday(year).getTime() - 2 * DAY_MS)
  return [
    ...FIXED_NATIONAL.map((f) => ({ date: `${year}-${f.md}`, name: f.name })),
    { date: dayKey(goodFriday), name: 'Sexta-feira Santa' },
  ].sort((x, y) => x.date.localeCompare(y.date))
}

export function nationalHolidays(year: number): string[] {
  return nationalHolidaysWithNames(year).map((h) => h.date)
}

export function isBusinessDay(date: Date, holidays: HolidaySet): boolean {
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !holidays.has(dayKey(date))
}

/** The n-th business day after `start` (UTC midnight); n = 0 returns `start`'s day. */
export function addBusinessDays(start: Date, n: number, holidays: HolidaySet): Date {
  let current = startOfUTCDay(start)
  let left = n
  while (left > 0) {
    current = new Date(current.getTime() + DAY_MS)
    if (isBusinessDay(current, holidays)) left--
  }
  return current
}

/** Business days d with from < d ≤ to (by UTC day); 0 when to ≤ from. */
export function businessDaysBetween(from: Date, to: Date, holidays: HolidaySet): number {
  let current = startOfUTCDay(from)
  const end = startOfUTCDay(to)
  let count = 0
  while (current < end) {
    current = new Date(current.getTime() + DAY_MS)
    if (isBusinessDay(current, holidays)) count++
  }
  return count
}
