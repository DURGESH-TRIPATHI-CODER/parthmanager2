import type {
  ClassificationResult,
  ColumnMapping,
  ContactIssue,
  NormalizedContact,
} from "./types";
import { normalizeAction } from "./normalizeAction";
import { cleanPhone, findDuplicateGroups, isValidPhone } from "./phone";
import { toLocalISODate } from "../shared/dateMatch";

/**
 * Convert mapped spreadsheet rows into normalized contact records, collecting
 * validation issues and duplicates along the way. Pure data work — no
 * sending, no messaging.
 */

/** Normalize birthday cell text to MM-DD; returns null when not parseable. */
export function normalizeBirthday(raw: string): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  // Excel often serializes dates as strings like "02-10-1990" (D-M-Y) or
  // "1990-10-02". SheetJS with raw:false usually gives us readable text.
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) {
    return `${String(parseInt(iso[2], 10)).padStart(2, "0")}-${String(parseInt(iso[3], 10)).padStart(2, "0")}`;
  }

  const named = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})/.exec(value);
  if (named) {
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const month = months[named[2].toLowerCase().slice(0, 3)];
    const day = parseInt(named[1], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

function cleanName(raw: string): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function classifyRows(
  rows: string[][],
  mapping: ColumnMapping,
): ClassificationResult {
  const contacts: NormalizedContact[] = [];
  const issues: ContactIssue[] = [];
  const idCounter = { n: 0 };

  if (mapping.name === undefined || mapping.name < 0) {
    issues.push({
      rowIndex: 0,
      kind: "missing-name",
      detail: "Name column is not mapped.",
    });
  }
  if (mapping.phone === undefined || mapping.phone < 0) {
    issues.push({
      rowIndex: 0,
      kind: "missing-phone",
      detail: "Phone column is not mapped.",
    });
  }

  rows.forEach((row, idx) => {
    const get = (col?: number): string => (col !== undefined && col >= 0 ? row[col] ?? "" : "");
    const name = cleanName(get(mapping.name));
    const phoneRaw = get(mapping.phone);
    const phone = cleanPhone(phoneRaw);
    const rawAction = get(mapping.action);
    const birthdayRaw = get(mapping.birthday);
    const sheetMessage = get(mapping.message);

    // Skip completely empty rows (no name AND no phone).
    if (!name && !phone) return;

    // Spreadsheet row number (1-based, header row is 1).
    const spreadsheetRow = idx + 2;

    if (!name) {
      issues.push({
        rowIndex: spreadsheetRow,
        kind: "missing-name",
        detail: "Name is empty.",
      });
    }
    if (!phone) {
      issues.push({
        rowIndex: spreadsheetRow,
        kind: "missing-phone",
        detail: "Phone is empty.",
      });
    } else if (!isValidPhone(phoneRaw)) {
      issues.push({
        rowIndex: spreadsheetRow,
        kind: "invalid-phone",
        detail: `Phone looks invalid: ${phone}`,
      });
    }

    const hasBirthdayColumn = mapping.birthday !== undefined && mapping.birthday >= 0;
    const birthdayMD = hasBirthdayColumn ? normalizeBirthday(birthdayRaw) : null;

    contacts.push({
      id: `c${++idCounter.n}`,
      name: name || "(no name)",
      phone,
      action: normalizeAction(rawAction),
      rawAction,
      birthdayMD,
      sheetMessage: sheetMessage || null,
    });
  });

  const duplicates = findDuplicateGroups(contacts);
  const byId = new Map(contacts.map((c) => [c.id, c]));
  for (const group of duplicates) {
    for (const id of group.ids) {
      const contact = byId.get(id);
      if (!contact) continue;
      issues.push({
        rowIndex: contacts.indexOf(contact) + 2,
        kind: "duplicate-phone",
        detail: `Duplicate phone number (${group.ids.length} rows share it).`,
      });
      (contact as { duplicate?: boolean }).duplicate = true;
    }
  }

  return { contacts, issues, duplicates };
}

/** Filter contacts whose birthday matches today (local time). */
export function todaysBirthdays(
  contacts: NormalizedContact[],
  today: Date = new Date(),
): NormalizedContact[] {
  const md = toLocalISODate(today).slice(5); // "MM-DD"
  return contacts.filter((c) => c.birthdayMD === md);
}
