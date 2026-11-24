import fs from "node:fs";
import path from "node:path";
import { app, dialog, BrowserWindow, shell } from "electron";
import * as XLSX from "xlsx";
import type {
  FileInfo,
  MatcherExportRequest,
  MatcherExportResult,
  MatcherReadRequest,
  MatcherPickResult,
} from "../shared/types";
import { readSheet, readWorkbookInfo } from "./excel";

/**
 * Structure Matcher main-process support: pick, read and export user-chosen
 * spreadsheets. Unlike the birthday flow, files may live anywhere — the user
 * picks them explicitly, so no root-folder restriction applies. The renderer
 * still never touches the filesystem itself.
 */

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB guard against huge/corrupt files
const SPREADSHEET_EXTENSIONS = ["xlsx", "xls", "csv"];
const MAX_ROWS = 200_000;
const MAX_COLUMNS = 500;
const MAX_CELLS = 4_000_000;

export function spreadsheetKind(filePath: string): FileInfo["kind"] {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return ext;
  return "unknown";
}

function validateSpreadsheetPath(fullPath: string): string | null {
  if (typeof fullPath !== "string" || !fullPath.trim()) return "No file specified.";
  const resolved = path.resolve(fullPath);
  if (spreadsheetKind(resolved) === "unknown") {
    return "Unsupported file type. Please choose an XLSX, XLS or CSV file.";
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return "File not found. It may have been moved or renamed.";
  }
  if (!stat.isFile()) return "That path is not a file.";
  if (stat.size > MAX_FILE_BYTES) return "File is too large (over 50 MB).";
  return null;
}

function spreadsheetFileInfo(resolved: string): FileInfo {
  return {
    filename: path.basename(resolved),
    fullPath: resolved,
    kind: spreadsheetKind(resolved),
    matchedDate: "",
    sizeBytes: fs.statSync(resolved).size,
  };
}

/** Validate a path supplied by drag-and-drop (no file dialog involved). */
export function openSpreadsheetPath(fullPath: string): MatcherPickResult {
  if (typeof fullPath !== "string" || !fullPath.trim()) {
    return { canceled: false, error: "No file specified." };
  }
  const resolved = path.resolve(fullPath);
  const problem = validateSpreadsheetPath(resolved);
  if (problem) return { canceled: false, error: problem };
  return { canceled: false, file: spreadsheetFileInfo(resolved) };
}

/** Open a file dialog and validate the chosen spreadsheet. */
export async function pickSpreadsheet(
  sender: Electron.WebContents | null,
  title: string,
): Promise<MatcherPickResult> {
  const options: Electron.OpenDialogOptions = {
    title,
    defaultPath: app.getPath("downloads"),
    properties: ["openFile"],
    filters: [
      { name: "Spreadsheets (XLSX, XLS, CSV)", extensions: SPREADSHEET_EXTENSIONS },
    ],
  };
  const win = sender ? BrowserWindow.fromWebContents(sender) : null;
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return openSpreadsheetPath(result.filePaths[0]);
}

/** Read a user-picked spreadsheet: sheet list, or one mapped-ready sheet. */
export function readMatcherSheet(req: Partial<MatcherReadRequest>) {
  if (!req || typeof req !== "object") throw new Error("Bad request.");
  const fullPath = path.resolve(String(req.fullPath ?? ""));
  const problem = validateSpreadsheetPath(fullPath);
  if (problem) throw new Error(problem);
  const file: FileInfo = {
    filename: path.basename(fullPath),
    fullPath,
    kind: spreadsheetKind(fullPath),
    matchedDate: "",
  };
  if (typeof req.sheetIndex === "number") {
    return readSheet(file, Math.max(0, Math.floor(req.sheetIndex)), req.noHeader === true);
  }
  return readWorkbookInfo(file);
}

function sanitizeRows(rows: unknown, label: string): string[] {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array.`);
  if (rows.length > MAX_COLUMNS) throw new Error(`${label} has too many columns (over ${MAX_COLUMNS}).`);
  return rows.map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
}

/** Word/Excel lock open files on Windows: retry with a numbered name, like downloads do. */
async function writeWithRetry(filePath: string, contents: Uint8Array): Promise<string> {
  try {
    await fs.promises.writeFile(filePath, contents);
    return filePath;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EBUSY" && code !== "EPERM") throw error;
  }
  const parsed = path.parse(filePath);
  for (let copy = 1; copy <= 999; copy += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${copy})${parsed.ext}`);
    try {
      await fs.promises.writeFile(candidate, contents, { flag: "wx" });
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST" && code !== "EBUSY" && code !== "EPERM") throw error;
    }
  }
  throw new Error("Could not find an available file name for the export.");
}

/** Show a save dialog, build the new spreadsheet and write it. */
export async function exportMatcherOutput(
  sender: Electron.WebContents,
  req: Partial<MatcherExportRequest>,
): Promise<MatcherExportResult> {
  if (!req || typeof req !== "object") throw new Error("Invalid export request.");
  const format = req.format === "csv" ? "csv" : "xlsx";
  const headers = sanitizeRows(req.headers, "Headers");
  if (headers.length === 0) throw new Error("Export has no headers.");
  if (!Array.isArray(req.rows)) throw new Error("Export rows must be an array.");
  if (req.rows.length > MAX_ROWS) throw new Error("Export has too many rows (over 200,000).");
  let cellCount = headers.length * req.rows.length;
  if (cellCount > MAX_CELLS) throw new Error("Export is too large.");
  const rows = req.rows.map((row) => sanitizeRows(row, "Export rows"));

  const defaultName =
    typeof req.defaultName === "string" && req.defaultName.trim()
      ? req.defaultName.trim().slice(0, 120)
      : "Structure Matcher Output";

  const parent = BrowserWindow.fromWebContents(sender);
  const options = {
    title: "Save reorganized spreadsheet",
    defaultPath: path.join(app.getPath("downloads"), `${defaultName}.${format}`),
    filters: [{ name: format === "csv" ? "CSV file" : "Excel workbook", extensions: [format] }],
  };
  const save = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (save.canceled || !save.filePath) return { canceled: true };

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Sensible column widths so the output opens legibly.
  const widths: Array<{ wch: number }> = [];
  for (let c = 0; c < headers.length; c++) {
    let max = headers[c].length;
    for (const row of rows) max = Math.max(max, (row[c] ?? "").length);
    widths.push({ wch: Math.min(60, Math.max(10, max + 2)) });
  }
  ws["!cols"] = widths;

  const sheetName =
    typeof req.sheetName === "string" && req.sheetName.trim()
      ? req.sheetName.trim().slice(0, 31)
      : "Matched Output";

  let contents: Uint8Array;
  if (format === "csv") {
    contents = new TextEncoder().encode(XLSX.utils.sheet_to_csv(ws));
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    contents = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  const savedPath = await writeWithRetry(path.resolve(save.filePath), contents);
  let openError: string | undefined;
  try {
    openError = (await shell.openPath(savedPath)) || undefined;
  } catch (error) {
    openError = error instanceof Error ? error.message : String(error);
  }
  return { canceled: false, filePath: savedPath, openError };
}
