// Format a SIMULATED peso amount for display, e.g. 500 -> "₱500.00".
// All money in this app is fake test data — callers should still label the UI
// as "test"/"simulated" around this value.
export function formatPeso(amount: number | string | null | undefined): string {
  const numeric = typeof amount === 'string' ? Number(amount) : amount ?? 0;
  // Guard: never crash the UI on a bad/empty value — show a safe zero instead.
  if (numeric === null || numeric === undefined || Number.isNaN(numeric)) {
    return '₱0.00';
  }
  return `₱${numeric.toFixed(2)}`;
}

// Format an ISO timestamp as a short, readable date + time, e.g.
// "Mon, Jun 23, 2:30 PM". Returns '' on a missing/invalid value so the UI never
// crashes on bad data.
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Turn any messy name input into proper Title Case.
// Examples: "maRk mArK" -> "Mark Mark", "  jOHN  doe " -> "John Doe".
export function toTitleCase(value: string): string {
  return value
    .trim()
    // Split on one-or-more spaces so extra spaces between words are collapsed.
    .split(/\s+/)
    // Upper-case the first letter of each word, lower-case the rest.
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    // Drop any empty pieces (e.g. when the input was an empty string).
    .filter(Boolean)
    .join(' ');
}
