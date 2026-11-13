import fs from "node:fs";
import * as XLSX from "xlsx";
import type {
  FileInfo,
  SheetSummary,
  WorkbookInfo,
  WorkbookSheetInfo,
} from "../shared/types";
import { normalizeHeader } from "../shared/headers";

/**
 * Excel/CSV reading via SheetJS (xlsx). Runs only in the Electron main
 * process — the renderer never touches the filesystem directly.
 *
 * No structure is assumed: we return raw headers and rows, and let the user
 * map columns in the UI.
 */

const HEADER_SCAN_LIMIT = 25; // how many rows to scan when detecting the header row

/** Excel-style column label: 0 -> A, 1 -> B, 25 -> Z, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const filled = cells.filter((c) => c !== "");
  if (filled.length < 2) return false;
  const nonNumeric = filled.filter((c) => !/^-?[\d.,:;/-]+$/.test(c)).length;
  return nonNumeric / filled.length >= 0.6; // mostly text => probably headers
}

/**
 * Detect the most likely header row among the first rows of the sheet.
 * Returns a 0-based index into the raw matrix.
 */
export function detectHeaderRow(matrix: string[][]): number {
  const limit = Math.min(matrix.length, HEADER_SCAN_LIMIT);
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] ?? [];
    const filled = row.filter((c) => c !== "").length;
    const texty = row.filter((c) => c !== "" && !/^-?[\d.,:;/-]+$/.test(c)).length;
    const unique = new Set(row.filter((c) => c !== "")).size;
    // Prefer rows with many distinct text cells; a date/title banner row
    // (single filled cell, or all-numeric row) scores low.
    const score = texty * 2 + unique + filled * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function toSheetSummary(
  name: string,
  index: number,
  matrix: string[][],
  noHeader = false,
): SheetSummary {
  const width = matrix.reduce((w, row) => Math.max(w, row.length), 0);

  // Fill missing header names so dropdowns stay aligned with data columns.
  const fillHeaders = (labels: string[]): string[] => {
    const headers: string[] = [];
    for (let c = 0; c < width; c++) {
      const label = cellToText(labels[c]);
      headers.push(label !== "" ? label : columnLetter(c));
    }
    return headers;
  };

  const collectRows = (startRow: number): string[][] => {
    const rows: string[][] = [];
    for (let r = startRow; r < matrix.length; r++) {
      const raw = matrix[r] ?? [];
      if (raw.every((cell) => cell === "")) continue; // skip blank rows
      const row: string[] = [];
      for (let c = 0; c < width; c++) row.push(cellToText(raw[c]));
      rows.push(row);
    }
    return rows;
  };

  // "First row is data" mode: no header row at all — every row is a record,
  // and columns are labeled with Excel letters (A, B, C…).
  if (noHeader) {
    return {
      name,
      index,
      headerRowIndex: 0,
      headers: Array.from({ length: width }, (_, c) => columnLetter(c)),
      rows: collectRows(0),
    };
  }

  const headerRowIndex = detectHeaderRow(matrix);
  return {
    name,
    index,
    headerRowIndex: headerRowIndex + 1,
    headers: fillHeaders(matrix[headerRowIndex] ?? []),
    rows: collectRows(headerRowIndex + 1),
  };
}

/** Read workbook metadata (sheet list) for a discovered file. */
export function readWorkbookInfo(file: FileInfo): WorkbookInfo {
  const wb = XLSX.readFile(file.fullPath, { dense: false });
  const sheets: WorkbookSheetInfo[] = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
    const range = ws?.["!ref"] ?? "A1:A1";
    const decoded = XLSX.utils.decode_range(range);
    const rowCount = Math.max(0, decoded.e.r - decoded.s.r + 1);
    return { name, index, rowCount };
  });
  return { fullPath: file.fullPath, filename: file.filename, sheets };
}

/** Read one worksheet of a workbook as a mapping-ready summary. */
export function readSheet(file: FileInfo, sheetIndex: number, noHeader = false): SheetSummary {
  const wb = XLSX.readFile(file.fullPath, { dense: false });
  const name = wb.SheetNames[sheetIndex];
  if (!name) throw new Error(`Worksheet index ${sheetIndex} not found`);
  const ws = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return toSheetSummary(name, sheetIndex, matrix, noHeader);
}

/** First worksheet of a workbook (default choice). */
export function readFirstSheet(file: FileInfo): SheetSummary {
  return readSheet(file, 0);
}

/** Check a file is readable before import; returns an error message if not. */
export function checkReadable(file: FileInfo): string | null {
  try {
    fs.accessSync(file.fullPath, fs.constants.R_OK);
    return null;
  } catch {
    return `Cannot read file: ${file.filename}`;
  }
}

/** Header signature used to remember column mappings across sessions. */
export function headerSignature(headers: string[]): string {
  return headers.map((h) => normalizeHeader(h) || "-").join("|");
}
