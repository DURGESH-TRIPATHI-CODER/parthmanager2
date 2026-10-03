/**
 * Phone number helpers: cleaning, basic validation, and duplicate grouping.
 * Deliberately lenient — Indian mobile numbers may arrive with +91, spaces,
 * dashes, or leading zeros. Validation flags clearly-suspicious values only.
 */

/** Strip everything except digits and a leading +. */
export function cleanPhone(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return (plus ? "+" : "") + digits;
}

/**
 * A phone value is considered valid if it has 10-15 digits after cleaning.
 * Too-short or empty values are flagged so the user can fix the sheet.
 */
export function isValidPhone(raw: string | null | undefined): boolean {
  const digits = cleanPhone(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/** Canonical form used for duplicate detection: digits only, minus country code noise. */
export function phoneKey(raw: string): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  // 91xxxxxxxxxx (12 digits starting 91) -> drop 91 so 98765... and +91 98765... collide.
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  // Leading zero (0xxxxxxxxxx) -> drop it.
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

/** Group contact ids by canonical phone key; only groups with 2+ ids returned. */
export function findDuplicateGroups<T extends { id: string; phone: string }>(
  contacts: T[],
): Array<{ phone: string; ids: string[] }> {
  const byKey = new Map<string, { phone: string; ids: string[] }>();
  for (const c of contacts) {
    const key = phoneKey(c.phone);
    if (!key) continue;
    const group = byKey.get(key);
    if (group) {
      group.ids.push(c.id);
    } else {
      byKey.set(key, { phone: c.phone, ids: [c.id] });
    }
  }
  return [...byKey.values()].filter((g) => g.ids.length >= 2);
}
