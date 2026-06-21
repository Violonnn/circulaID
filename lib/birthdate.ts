// Helpers for the date-of-birth dropdowns and the age calculation. Kept out of
// the screen so RegisterScreen stays short and easy to read.

export type DateOption = { label: string; value: string };

// The 12 months. `value` is the month number ("1" = January) so we can do math.
export const MONTH_OPTIONS: DateOption[] = [
  { label: 'January', value: '1' },
  { label: 'February', value: '2' },
  { label: 'March', value: '3' },
  { label: 'April', value: '4' },
  { label: 'May', value: '5' },
  { label: 'June', value: '6' },
  { label: 'July', value: '7' },
  { label: 'August', value: '8' },
  { label: 'September', value: '9' },
  { label: 'October', value: '10' },
  { label: 'November', value: '11' },
  { label: 'December', value: '12' },
];

// Days 1–31. Impossible combinations (e.g. Feb 30) are caught by isRealDate().
export const DAY_OPTIONS: DateOption[] = Array.from({ length: 31 }, (_, i) => ({
  label: String(i + 1),
  value: String(i + 1),
}));

// Years from this year back 100 years, newest first.
export const YEAR_OPTIONS: DateOption[] = (() => {
  const currentYear = new Date().getFullYear();
  const years: DateOption[] = [];
  for (let year = currentYear; year >= currentYear - 100; year--) {
    years.push({ label: String(year), value: String(year) });
  }
  return years;
})();

// Confirm the picked day actually exists in that month/year. JavaScript "rolls
// over" invalid dates (Feb 30 -> Mar 2), so we build the date and check it kept
// the same parts we put in.
export function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

// Work out the user's age today from their birth date. We subtract a year if
// their birthday hasn't happened yet this year.
export function calculateAge(year: number, month: number, day: number): number {
  const today = new Date();
  let age = today.getFullYear() - year;

  const birthdayNotYetThisYear =
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day);

  if (birthdayNotYetThisYear) age -= 1;
  return age;
}

// Zero-pad to two digits ("3" -> "03").
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Number of days in a given month (handles leap years).
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Build a Postgres `date` string ("YYYY-MM-DD"), clamping the day to a value
// that exists in the chosen month (so editing month/year never yields Feb 30).
export function toBirthDateString(year: number, month: number, day: number): string {
  const safeDay = Math.min(Math.max(day, 1), daysInMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(safeDay)}`;
}

// Parse a stored "YYYY-MM-DD" date into numeric parts, or null if absent/bad.
export function parseBirthDate(
  value: string | null | undefined
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

// The month name for a 1-based month number ("1" -> "January").
export function monthLabel(month: number): string {
  return MONTH_OPTIONS.find((option) => Number(option.value) === month)?.label ?? '';
}

// Human-friendly "January 1998" from a stored birth_date, or null.
export function formatBirthMonthYear(value: string | null | undefined): string | null {
  const parts = parseBirthDate(value);
  if (!parts) return null;
  return `${monthLabel(parts.month)} ${parts.year}`;
}

// Derive the current age from a stored birth_date, or null if unknown.
export function ageFromBirthDate(value: string | null | undefined): number | null {
  const parts = parseBirthDate(value);
  if (!parts) return null;
  return calculateAge(parts.year, parts.month, parts.day);
}
