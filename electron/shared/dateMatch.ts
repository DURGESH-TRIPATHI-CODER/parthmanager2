/**
 * Date parsing/matching for daily ParthSeva filenames.
 *
 * Goal: find files whose filename contains today's date, without requiring an
 * exact filename. Supports common Windows-friendly formats:
 *   02-10-2026, 02_10_2026, 02.10.2026, 02 10 2026, 2-10-2026,
 *   02 October 2026, 2 Oct 2026, 2026-10-02
 *
 * Pure functions only — no Node APIs — so this is unit-testable anywhere.
 */

export interface ParsedFilenameDate {
  /** The matched substring from the filename, e.g. "02-10-2026". */
  matched: string;
  year: number;
  month: number; // 1-based
  day: number;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** D-M-YYYY or YYYY-M-D with -, _, ., or space separators. */
const NUMERIC_RE = /(?:(\d{1,2})[-_. ](\d{1,2})[-_. ](\d{4}))|(?:(\d{4})[-_. ](\d{1,2})[-_. ](\d{1,2}))/;

/** D[-_. ]MonthName[-_. ]YYYY, e.g. "02 October 2026" or "2 Oct 2026". */
const MONTH_NAME_RE = /(\d{1,2})[-_. ]([A-Za-z]{3,9})[-_. ](\d{4})/;

/** MonthName[-_. ]D[-_. ]YYYY, e.g. "October 02 2026". */
const MONTH_FIRST_RE = /([A-Za-z]{3,9})[-_. ](\d{1,2})[-_. ](\d{4})/;

/** Strip a file extension only when it looks like one (contains a letter). */
function stripExtension(filename: string): string {
  return filename.replace(/\.[A-Za-z][A-Za-z0-9]{0,4}$/, "");
}

/** Validate a calendar date (rejects 31-02-2026, month 13, etc.). */
function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
  );
}

/**
 * Extract the first date-looking substring from a filename stem.
 * Returns null when the filename contains no recognizable date.
 */
export function parseFilenameDate(filename: string): ParsedFilenameDate | null {
  const name = stripExtension(filename);

  const named = MONTH_NAME_RE.exec(name);
  if (named) {
    const day = parseInt(named[1], 10);
    const month = MONTH_NAMES[named[2].toLowerCase()];
    const year = parseInt(named[3], 10);
    if (month !== undefined && isValidDate(year, month, day)) {
      return { matched: named[0], year, month, day };
    }
  }

  const monthFirst = MONTH_FIRST_RE.exec(name);
  if (monthFirst) {
    const month = MONTH_NAMES[monthFirst[1].toLowerCase()];
    const day = parseInt(monthFirst[2], 10);
    const year = parseInt(monthFirst[3], 10);
    if (month !== undefined && isValidDate(year, month, day)) {
      return { matched: monthFirst[0], year, month, day };
    }
  }

  const numeric = NUMERIC_RE.exec(name);
  if (numeric) {
    if (numeric[1] !== undefined) {
      // D-M-YYYY (the convention these files use)
      const day = parseInt(numeric[1], 10);
      const month = parseInt(numeric[2], 10);
      const year = parseInt(numeric[3], 10);
      if (isValidDate(year, month, day)) {
        return { matched: numeric[0], year, month, day };
      }
    } else {
      // YYYY-M-D
      const year = parseInt(numeric[4], 10);
      const month = parseInt(numeric[5], 10);
      const day = parseInt(numeric[6], 10);
      if (isValidDate(year, month, day)) {
        return { matched: numeric[0], year, month, day };
      }
    }
  }

  return null;
}

/** True when the filename contains the given local calendar date. */
export function filenameMatchesDay(filename: string, date: Date): boolean {
  const parsed = parseFilenameDate(filename);
  if (!parsed) return false;
  return (
    parsed.year === date.getFullYear() &&
    parsed.month === date.getMonth() + 1 &&
    parsed.day === date.getDate()
  );
}

/** English month folder name, e.g. 9 -> "October". */
export function monthFolderName(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

/** Local-time ISO date string (no UTC shift), e.g. "2026-10-02". */
export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
