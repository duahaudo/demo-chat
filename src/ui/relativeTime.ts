/** `now` is a parameter rather than a call, so a row's timestamp is testable without a fake clock. */

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(at: number, now: number): string {
  const elapsed = at - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return formatter.format(Math.round(elapsed / size), unit);
  }
  return formatter.format(0, 'second');
}
