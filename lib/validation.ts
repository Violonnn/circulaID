// Small, pure validation helpers. Keeping them here (no React, no Supabase) makes
// them easy to reason about and reuse from any screen — and easy to test later.

// The single stored shape for a Philippine mobile number: +63 followed by the
// 10 significant digits (the leading 9... of the subscriber number).
const PH_INTERNATIONAL = /^\+63\d{10}$/;
// Local dialing shape: 09 followed by 9 more digits (11 digits total).
const PH_LOCAL = /^09\d{9}$/;

// Normalize a Philippine mobile number to the stored +63 format, or return null
// if the input is not a valid PH mobile number in either accepted shape.
//
// Accepts:   "09171234567"      -> "+639171234567"
//            "0917 123 4567"    -> "+639171234567"  (spaces/dashes stripped)
//            "+639171234567"    -> "+639171234567"  (already normalized)
// Rejects:   anything else (wrong length, letters, other prefixes) -> null
export function normalizePhoneNumber(input: string): string | null {
  // Guard: strip the spaces and dashes a user might type for readability before
  // we test the shape, e.g. "0917 123 4567" / "0917-123-4567".
  const cleaned = input.replace(/[\s-]/g, '');

  // Local 09XXXXXXXXX -> drop the leading 0 and prefix +63.
  if (PH_LOCAL.test(cleaned)) return `+63${cleaned.slice(1)}`;
  // Already in the international +63XXXXXXXXXX shape -> keep as-is.
  if (PH_INTERNATIONAL.test(cleaned)) return cleaned;

  // Guard: not one of the two valid shapes -> caller should show an error.
  return null;
}
