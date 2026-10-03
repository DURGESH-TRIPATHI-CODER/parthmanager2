import fs from "node:fs";
import path from "node:path";
import type { DiscoveryResult, FileKind, FileInfo } from "../shared/types";
import { filenameMatchesDay, monthFolderName, toLocalISODate } from "../shared/dateMatch";

/** Extensions we accept as daily ParthSeva files. */
const ACCEPTED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);

/** Excel/Office lock files like "~$02-10-2026.xlsx" must be ignored. */
function isTempFile(filename: string): boolean {
  return filename.startsWith("~$") || filename.startsWith("~");
}

function extensionKind(filename: string): FileKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".xls") return "xls";
  if (ext === ".csv") return "csv";
  return "unknown";
}

/**
 * Find candidate daily files for the given date inside the configured root.
 * Looks in the month folder for that date's month. Never throws: errors are
 * returned on the result so the UI can show them.
 */
export function findFilesForDate(rootFolder: string, date: Date): DiscoveryResult {
  const dateISO = toLocalISODate(date);
  const monthName = monthFolderName(date);
  const monthFolder = path.join(rootFolder, monthName);

  let entries: string[];
  try {
    entries = fs.readdirSync(monthFolder, { withFileTypes: false }).map(String);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return {
        dateISO,
        monthName,
        monthFolder,
        files: [],
        error: `Month folder not found: ${monthName}`,
      };
    }
    const detail = code === "EACCES" || code === "EPERM" ? " (no permission)" : "";
    return {
      dateISO,
      monthName,
      monthFolder,
      files: [],
      error: `Cannot read folder "${monthName}"${detail}.`,
    };
  }

  const files: FileInfo[] = [];
  for (const entry of entries) {
    const filename = path.basename(entry);
    if (isTempFile(filename)) continue;
    if (!ACCEPTED_EXTENSIONS.has(path.extname(filename).toLowerCase())) continue;

    let fullPath: string;
    try {
      fullPath = path.join(monthFolder, filename);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (!filenameMatchesDay(filename, date)) continue;
      files.push({
        filename,
        fullPath,
        kind: extensionKind(filename),
        matchedDate: dateISO,
        sizeBytes: stat.size,
      });
    } catch {
      // Unreadable entry — skip it rather than failing the whole scan.
      continue;
    }
  }

  // Deterministic order: alphabetical.
  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return { dateISO, monthName, monthFolder, files };
}
