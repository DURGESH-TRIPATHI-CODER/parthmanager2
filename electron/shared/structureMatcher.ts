/**
 * Structure Matcher engine: reorders File B rows to follow File A's sequence.
 *
 * Pure functions, no UI and no filesystem — the renderer calls these with
 * already-parsed sheet data. Deterministic by design: only exact (normalized)
 * name matches are accepted, and ambiguous names are never moved.
 */

/** Fold case, collapse whitespace, strip zero-width characters. No fuzzy logic. */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** One normalized name and where it appears in each file. */
export interface NameGroup {
  /** Normalized form used for matching. */
  key: string;
  /** First raw spelling seen, for display. */
  display: string;
  /** 0-based data-row indices in File A. */
  aRows: number[];
  /** 0-based data-row indices in File B. */
  bRows: number[];
}

/** An A row whose name has no counterpart in File B. */
export interface MissingRecord {
  /** 0-based A data-row index. */
  aIndex: number;
  /** Raw name text from File A. */
  name: string;
  /** 1-based spreadsheet row number (header row + offset) for display. */
  sheetRow: number;
}

export interface MatchedPair {
  aIndex: number;
  bIndex: number;
  /** Raw File B spelling of the matched name. */
  name: string;
}

export interface StructureMatchAnalysis {
  totalA: number;
  totalB: number;
  /** Fully-empty rows dropped before matching (they hold no data). */
  emptyARowsRemoved: number;
  emptyBRowsRemoved: number;
  /** B rows with data but an empty Name cell — kept at the top, flagged. */
  unnamedBRows: number[];
  /** A rows with data but an empty Name cell — cannot be sequenced, flagged. */
  unnamedARows: number[];
  /** Names appearing more than once in A and/or B. Never auto-matched. */
  duplicateGroups: NameGroup[];
  /** A rows whose name has no B counterpart at all. */
  missingInB: MissingRecord[];
  /** Unambiguous pairs, listed in File A order. */
  matched: MatchedPair[];
  /** B row indices kept at the top (unmatched), in original order. */
  unmatchedBIndices: number[];
  /** Unmatched B rows excluded from matching because of a duplicate name. */
  ambiguousBIndices: number[];
  /* ---- summary metrics ---- */
  matchedCount: number;
  unmatchedCount: number;
  missingCount: number;
  duplicateNameCount: number;
  outputRows: number;
}

export interface StructureMatchInput {
  aRows: string[][];
  /** 0-based column index of the Name column in File A. */
  aNameColumn: number;
  bRows: string[][];
  /** 0-based column index of the Name column in File B. */
  bNameColumn: number;
}

function isFullyEmpty(row: string[]): boolean {
  return row.every((cell) => String(cell ?? "").trim() === "");
}

function collectGroups(
  rows: string[][],
  nameColumn: number,
  side: "a" | "b",
  groups: Map<string, NameGroup>,
): { total: number; emptyRemoved: number; unnamed: number[] } {
  const unnamed: number[] = [];
  let emptyRemoved = 0;
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isFullyEmpty(row)) {
      emptyRemoved++;
      continue;
    }
    total++;
    const name = String(row[nameColumn] ?? "").trim();
    if (name === "") {
      unnamed.push(i);
      continue;
    }
    const key = normalizeName(name);
    let group = groups.get(key);
    if (!group) {
      group = { key, display: name, aRows: [], bRows: [] };
      groups.set(key, group);
    }
    if (side === "a") group.aRows.push(i);
    else group.bRows.push(i);
  }
  return { total, emptyRemoved, unnamed };
}

/**
 * Compare both files and classify every row. Never mutates inputs and never
 * guesses: names that differ in spelling stay unmatched, names that appear
 * more than once in either file stay unmatched until reviewed.
 */
export function analyzeStructureMatch(input: StructureMatchInput): StructureMatchAnalysis {
  const groups = new Map<string, NameGroup>();
  const a = collectGroups(input.aRows, input.aNameColumn, "a", groups);
  const b = collectGroups(input.bRows, input.bNameColumn, "b", groups);

  const all = [...groups.values()];
  const duplicateGroups = all.filter((g) => g.aRows.length > 1 || g.bRows.length > 1);
  const ambiguousKeys = new Set(duplicateGroups.map((g) => g.key));

  const missingInB: MissingRecord[] = [];
  for (const group of all) {
    if (group.bRows.length > 0) continue;
    for (const aIndex of group.aRows) {
      missingInB.push({
        aIndex,
        name: group.display,
        sheetRow: aIndex + 2, // 1-based, below a 1-row header
      });
    }
  }

  const matched: MatchedPair[] = [];
  const usedB = new Set<number>();
  for (const group of all) {
    if (ambiguousKeys.has(group.key)) continue;
    if (group.aRows.length === 1 && group.bRows.length === 1) {
      const bIndex = group.bRows[0];
      usedB.add(bIndex);
      matched.push({ aIndex: group.aRows[0], bIndex, name: group.display });
    }
  }
  // matched is naturally in File A order because groups were built in A order.
  matched.sort((x, y) => x.aIndex - y.aIndex);

  const unmatchedBIndices: number[] = [];
  const ambiguousBIndices: number[] = [];
  for (let i = 0; i < input.bRows.length; i++) {
    if (usedB.has(i)) continue;
    const row = input.bRows[i];
    if (isFullyEmpty(row)) continue;
    unmatchedBIndices.push(i);
    const key = normalizeName(String(row[input.bNameColumn] ?? ""));
    if (ambiguousKeys.has(key)) ambiguousBIndices.push(i);
  }

  const matchedCount = matched.length;
  const unmatchedCount = unmatchedBIndices.length;
  return {
    totalA: a.total,
    totalB: b.total,
    emptyARowsRemoved: a.emptyRemoved,
    emptyBRowsRemoved: b.emptyRemoved,
    unnamedARows: a.unnamed,
    unnamedBRows: b.unnamed,
    duplicateGroups,
    missingInB,
    matched,
    unmatchedBIndices,
    ambiguousBIndices,
    matchedCount,
    unmatchedCount,
    missingCount: missingInB.length,
    duplicateNameCount: duplicateGroups.length,
    outputRows: unmatchedCount + matchedCount,
  };
}

/** A user-created link between one File A row and one File B row. */
export interface ManualPair {
  /** 0-based data-row index in File A. */
  aIndex: number;
  /** 0-based data-row index in File B. */
  bIndex: number;
}

export type OutputSegmentKind = "in-place" | "moved";

export interface OutputSegment {
  /** Inclusive start row in the output. */
  start: number;
  /** Exclusive end row in the output. */
  end: number;
  kind: OutputSegmentKind;
}

export interface MatcherOutput {
  /** Complete File B rows: rows kept in place first (original order), then moved rows in File A order. */
  rows: string[][];
  /** File B row index backing each output row (same length as rows). */
  sourceIndices: number[];
  segments: OutputSegment[];
}

/**
 * Build the final row sequence. Every non-empty B row appears exactly once;
 * nothing is dropped or overwritten.
 *
 * `selectedAIndexes` restricts which matched rows are moved: only pairs whose
 * File A row is selected go to the end (in File A order); all other rows stay
 * in place in their original order. Omit it to move every matched row.
 *
 * `manualPairs` adds user-created links (e.g. across a spelling difference or
 * between duplicates). Only well-formed pairs are honored: both rows must
 * exist and not already be used by an automatic match or another pair. All
 * moved rows — automatic and manual — are ordered by their File A position.
 *
 * `includeInPlace` (default true) controls whether rows that are NOT moved —
 * unmatched extras and unselected matches — are kept in the output. Set it to
 * false to export only the moved rows.
 */
export function buildMatcherOutput(
  bRows: string[][],
  analysis: StructureMatchAnalysis,
  selectedAIndexes?: ReadonlySet<number>,
  manualPairs: readonly ManualPair[] = [],
  includeInPlace = true,
): MatcherOutput {
  const autoMoved = selectedAIndexes
    ? analysis.matched.filter((pair) => selectedAIndexes.has(pair.aIndex))
    : analysis.matched;

  // Validate manual pairs: no collisions with automatic matches, with each
  // other, or with missing/empty rows.
  const usedA = new Set<number>(autoMoved.map((pair) => pair.aIndex));
  const usedB = new Set<number>(autoMoved.map((pair) => pair.bIndex));
  const validManual: ManualPair[] = [];
  for (const pair of manualPairs) {
    if (!pair) continue;
    const { aIndex, bIndex } = pair;
    if (!Number.isInteger(aIndex) || !Number.isInteger(bIndex)) continue;
    if (aIndex < 0 || bIndex < 0 || bIndex >= bRows.length) continue;
    if (isFullyEmpty(bRows[bIndex])) continue;
    if (usedA.has(aIndex) || usedB.has(bIndex)) continue;
    usedA.add(aIndex);
    usedB.add(bIndex);
    validManual.push({ aIndex, bIndex });
  }

  const movedPairs = [...autoMoved, ...validManual].sort((x, y) => x.aIndex - y.aIndex);
  const movedB = new Set(movedPairs.map((pair) => pair.bIndex));

  const inPlace: number[] = [];
  if (includeInPlace) {
    for (let i = 0; i < bRows.length; i++) {
      if (isFullyEmpty(bRows[i])) continue;
      if (!movedB.has(i)) inPlace.push(i);
    }
  }
  const sourceIndices = [...inPlace, ...movedPairs.map((pair) => pair.bIndex)];

  return {
    rows: sourceIndices.map((i) => bRows[i]),
    sourceIndices,
    segments: [
      { start: 0, end: inPlace.length, kind: "in-place" },
      { start: inPlace.length, end: inPlace.length + movedPairs.length, kind: "moved" },
    ],
  };
}
