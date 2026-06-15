/**
 * Event timezone helpers.
 *
 * Empiria is a global platform: every event carries its own IANA timezone
 * (`events.timezone`, e.g. America/New_York). A `datetime-local` input in the
 * event wizard MEANS wall time in the EVENT's timezone. On submit we convert
 * that wall time to a real UTC instant (DST-aware); on edit-hydration we convert
 * the stored UTC instant back to wall time in the event's zone.
 *
 * All date *display* must pass the event's `timeZone` to the Intl/toLocale*
 * formatters (server runs UTC on Vercel), and show the zone label so a buyer in
 * another timezone knows it's the event's local time. Use `formatEventDateTime`.
 */

export const TORONTO_TZ = 'America/Toronto';
/** Fallback used only when an event row predates the timezone column. */
export const DEFAULT_TZ = 'America/Toronto';

/**
 * Offset (in minutes) of `timeZone` from UTC at the given instant.
 * Positive = ahead of UTC. Intl trick: format the instant in the target zone,
 * read back the wall-clock fields, and diff against the instant's UTC fields.
 */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return Math.round((wallAsUtc - instant.getTime()) / 60000);
}

/**
 * Interpret a naive `datetime-local` string ('YYYY-MM-DDTHH:mm') as wall time
 * in `timeZone` and return the real UTC instant as an ISO string. DST-correct:
 * computes the zone offset *for that date* (guess, then refine once so dates
 * near a DST switch resolve with the correct offset). Empty input passes
 * through unchanged so '' keeps its "unset" meaning.
 */
export function zonedLocalToUtcIso(local: string, timeZone: string = DEFAULT_TZ): string {
  if (!local) return local;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return local; // not a naive datetime-local string; leave untouched
  const [, y, mo, d, h, mi, s] = m;
  const wallAsUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  let offset = tzOffsetMinutes(new Date(wallAsUtc), timeZone);
  offset = tzOffsetMinutes(new Date(wallAsUtc - offset * 60000), timeZone);
  return new Date(wallAsUtc - offset * 60000).toISOString();
}

/**
 * Convert a stored UTC instant (ISO / timestamptz) to the wall-time
 * `datetime-local` value ('YYYY-MM-DDTHH:mm') in `timeZone`, for input
 * hydration. Inverse of `zonedLocalToUtcIso`. Returns '' for empty/invalid.
 */
export function utcIsoToZonedLocal(iso: string | null | undefined, timeZone: string = DEFAULT_TZ): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Display a UTC instant in the event's timezone, with the zone label.
 * e.g. "Sun, Nov 29, 2026 · 7:00 PM EST". Use across all event date display.
 */
export function formatEventDateTime(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TZ,
  opts: { withWeekday?: boolean; withYear?: boolean; withTime?: boolean; withTz?: boolean; longMonth?: boolean } = {}
): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const {
    withWeekday = true,
    withYear = true,
    withTime = true,
    withTz = true,
    longMonth = false,
  } = opts;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || DEFAULT_TZ,
    ...(withWeekday ? { weekday: 'short' as const } : {}),
    month: longMonth ? ('long' as const) : ('short' as const),
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
    ...(withTime ? { hour: 'numeric' as const, minute: '2-digit' as const, hour12: true } : {}),
    ...(withTime && withTz ? { timeZoneName: 'short' as const } : {}),
  }).format(date);
}

/** Just the timezone abbreviation for an instant (e.g. "EST", "PDT", "GMT+5:30"). */
export function tzAbbreviation(iso: string | null | undefined, timeZone: string = DEFAULT_TZ): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || DEFAULT_TZ,
    timeZoneName: 'short',
  })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

// ── Backward-compatible Toronto wrappers (used by coupon windows, which are
// platform-relative, not event-relative). ────────────────────────────────────
export function torontoLocalToUtcIso(local: string): string {
  return zonedLocalToUtcIso(local, TORONTO_TZ);
}
export function utcIsoToTorontoLocal(iso: string | null | undefined): string {
  return utcIsoToZonedLocal(iso, TORONTO_TZ);
}
