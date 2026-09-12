// THE ONE DEFINITION OF "WHICH DAY IS IT" IN THE FRONTEND.
//
// ⛔ DO NOT use toISOString().slice(0,10) to get a calendar date. That is the
// UTC date, and it is exactly the bug this file exists to close: after 8pm
// Eastern it already reads as tomorrow, so a 10pm check-in was filed under the
// next day and the next morning's check-in overwrote it (2026-09-12).
//
// A day here is midnight to midnight on the DEVICE's own calendar, which is the
// day the person using it believes they are in. The check-in carries this date
// to the server, which stores it on the row as local_date; every screen then
// buckets by that stored date rather than re-deriving a day from a timestamp.
// That is also why a therapist in another time zone now reads the same days
// their patient does.

/** The calendar date on this device, as 'YYYY-MM-DD'. */
export function localDateString(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Whole days from `dateStr` ('YYYY-MM-DD') to today, by calendar day. */
export function daysSinceLocalDate(dateStr, today = new Date()) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return null
  // Compare at local midnight on both sides so DST never adds or drops a day.
  const then = new Date(y, m - 1, d).setHours(0, 0, 0, 0)
  const now = new Date(today).setHours(0, 0, 0, 0)
  return Math.round((now - then) / 86400000)
}

/** 'YYYY-MM-DD' for `offset` days before today, on this device's calendar. */
export function localDateOffset(offset, from = new Date()) {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - offset)
  return localDateString(d)
}
