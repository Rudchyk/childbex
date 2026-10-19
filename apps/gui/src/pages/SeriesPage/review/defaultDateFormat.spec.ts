/**
 * The shared review date format: two-digit seconds, in local time (as
 * shown by every consumer: completions, reviewer progress, resolutions).
 */
import { format } from 'date-fns';
import { defaultDateFormat } from '@libs/constants';

it.each([
  [new Date(2026, 9, 19, 12, 45, 39), '19/10/2026 12:45:39'],
  [new Date(2026, 0, 2, 3, 4, 5), '02/01/2026 03:04:05'],
  [new Date(2026, 11, 31, 23, 59, 0), '31/12/2026 23:59:00'],
])('formats %s as %s', (date, expected) => {
  expect(format(date, defaultDateFormat)).toBe(expected);
  // An ISO string (as the API sends it) is shown in local time too.
  expect(format(date.toISOString(), defaultDateFormat)).toBe(expected);
});
