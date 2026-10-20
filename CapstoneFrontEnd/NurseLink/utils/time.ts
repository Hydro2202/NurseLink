/**
 * Display formatting for times and dates — the one place every Nurse, Head
 * Nurse and Admin screen formats a clock time, so they all read the same:
 * 12-hour with AM/PM ("1:00 PM", "12:00 AM"), never military time.
 *
 * Display only: stored values keep their own format ("HH:MM" for task due
 * times and duty shifts, ISO timestamps for everything else) and are never
 * replaced by these strings. Fixed to en-US so a device set to a 24-hour
 * locale still shows AM/PM.
 */

const LOCALE = 'en-US';

/** "13:00" / "13:00:00" → "1:00 PM". Blank stays blank; anything that isn't
 * a valid HH:MM is returned unchanged rather than guessed at. */
export function formatTime12(value?: string | null): string {
  if (!value) return '';
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return value;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

function toDate(value?: string | number | Date | null): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A timestamp's clock time: "2:30 PM". */
export function formatClock(value?: string | number | Date | null): string {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
}

/** "Oct 21, 2026". Accepts an ISO timestamp or a plain "YYYY-MM-DD" date
 * (read as a local calendar date, so it never shifts a day across time zones). */
export function formatDateOnly(value?: string | null): string {
  if (!value) return '';
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/** "Oct 21, 2026, 2:30 PM" from an ISO timestamp. '' for blank/invalid. */
export function formatDateTime12(value?: string | number | Date | null): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleString(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** "Oct 21, 2:30 PM" — same as above without the year, for compact lists. */
export function formatShortDateTime12(value?: string | number | Date | null): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleString(LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** A task's due date + "HH:MM" due time: "Oct 21 · 2:30 PM". */
export function formatDueDateTime(date?: string | null, time?: string | null): string {
  const datePart = date ? formatDateOnly(date).replace(/, \d{4}$/, '') : '';
  const timePart = formatTime12(time);
  return [datePart, timePart].filter(Boolean).join(' · ');
}
