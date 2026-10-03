import type { MappingCandidate, MappingField } from "./types";

/** Lowercase, remove non-letters, collapse whitespace for fuzzy header matching. */
export function normalizeHeader(header: string): string {
  return (header ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

interface FieldPatterns {
  field: MappingField;
  exact: string[]; // normalized header equals one of these
  contains: string[]; // normalized header contains one of these
  weight: number; // relative confidence
}

const PATTERNS: FieldPatterns[] = [
  {
    field: "name",
    exact: ["name", "fullname", "personname", "membername", "member", "contactname"],
    contains: ["name"],
    weight: 1.0,
  },
  {
    field: "phone",
    exact: ["phone", "mobile", "mobilenumber", "number", "contactnumber", "phonenumber", "whatsappnumber", "contact"],
    contains: ["phone", "mobile", "whatsapp"],
    weight: 1.0,
  },
  {
    field: "action",
    exact: ["action", "type", "contacttype", "task", "todo"],
    contains: ["action", "type"],
    weight: 1.0,
  },
  {
    field: "birthday",
    exact: ["birthday", "dob", "birthdate", "dateofbirth", "bday"],
    contains: ["birthday", "birth", "bday"],
    weight: 1.0,
  },
  {
    field: "message",
    exact: ["message", "text", "whatsappmessage", "custommessage", "note", "notes"],
    contains: ["message", "text"],
    weight: 1.0,
  },
];

/** Score one header for one field; higher is better, 0 means no match. */
function scoreHeader(header: string, p: FieldPatterns): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  if (p.exact.includes(h)) return 1.0;
  for (const frag of p.contains) {
    if (h.includes(frag)) return 0.7;
  }
  return 0;
}

/**
 * Suggest a mapping for each field from the sheet headers.
 * Suggestions are advisory only — the user always confirms the final mapping.
 * Never assigns the same column to two different fields when a better
 * alternative exists (greedy assignment by score).
 */
export function suggestMapping(headers: string[]): MappingCandidate[] {
  const candidates: Array<MappingCandidate & { field: MappingField }> = [];
  for (const p of PATTERNS) {
    for (let i = 0; i < headers.length; i++) {
      const score = scoreHeader(headers[i], p);
      if (score > 0) candidates.push({ field: p.field, columnIndex: i, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedColumns = new Set<number>();
  const picked: MappingCandidate[] = [];
  for (const c of candidates) {
    if (usedColumns.has(c.columnIndex)) continue;
    if (picked.some((p) => p.field === c.field)) continue;
    usedColumns.add(c.columnIndex);
    picked.push(c);
  }
  return picked;
}
