/**
 * Shared types used by both the Electron main process and the React renderer.
 * These define the IPC contract between the two sides.
 */

export type FileKind = "xlsx" | "xls" | "csv" | "unknown";

/** Metadata about a discovered daily ParthSeva file. */
export interface FileInfo {
  filename: string;
  fullPath: string;
  kind: FileKind;
  /** The date string extracted from the filename, e.g. "02-10-2026". */
  matchedDate: string;
  /** File size in bytes, if available. */
  sizeBytes?: number;
}

/** Result of searching today's month folder for daily files. */
export interface DiscoveryResult {
  dateISO: string; // e.g. "2026-10-02"
  monthName: string; // e.g. "October"
  monthFolder: string; // full path
  files: FileInfo[]; // matching files (may be empty)
  error?: string; // set when the month folder is missing/unreadable
  /** True when no ParthSeva root folder is configured yet (first run). */
  notConfigured?: boolean;
}

export interface Settings {
  /** Absolute path of the configured ParthSeva root folder. */
  rootFolder: string | null;
}

export interface SettingsResult {
  settings: Settings;
}

export interface SetRootFolderRequest {
  path: string;
}

export interface ValidationResult {
  ok: boolean;
  message: string;
}

/* ------------------------- Sheet import ------------------------- */

/** A parsed worksheet ready for mapping in the UI. */
export interface SheetSummary {
  name: string;
  index: number;
  headerRowIndex: number; // 1-based row number of detected header row
  headers: string[]; // header cell values
  rows: string[][]; // data rows below the header row (raw cell text)
}

/** One detected workbook sheet, offered to the user when several exist. */
export interface WorkbookSheetInfo {
  name: string;
  index: number;
  rowCount: number;
}

export interface WorkbookInfo {
  fullPath: string;
  filename: string;
  sheets: WorkbookSheetInfo[];
}

/* ------------------------- Column mapping ------------------------- */

export type MappingField = "name" | "phone" | "action" | "birthday" | "message";

/** Maps a logical field to a 0-based column index, or -1 / undefined for "not used". */
export type ColumnMapping = Partial<Record<MappingField, number>>;

export interface MappingCandidate {
  field: MappingField;
  columnIndex: number;
  score: number;
}

export interface SavedMapping {
  /** Normalized header signature used to re-recognize this layout. */
  headerSignature: string;
  headerRowIndex: number;
  mapping: ColumnMapping;
  savedAt: string;
}

export interface MappingLookupRequest {
  headers: string[];
  headerRowIndex: number;
}

export interface MappingLookupResult {
  mapping: ColumnMapping | null;
  savedAt?: string;
}

export interface SaveMappingRequest {
  headers: string[];
  headerRowIndex: number;
  mapping: ColumnMapping;
}

/* ------------------------- Normalized contacts ------------------------- */

export type ContactAction = "message" | "call" | "review";

export interface NormalizedContact {
  id: string;
  name: string;
  phone: string;
  action: ContactAction;
  /** Raw action text from the sheet, kept for Needs Review display. */
  rawAction: string;
  /** Normalized birthday "MM-DD" if a Birthday column exists and parses, else null. */
  birthdayMD: string | null;
  /** Row-specific custom message text from the sheet, if any. */
  sheetMessage: string | null;
}

export type ContactIssueKind =
  | "missing-name"
  | "missing-phone"
  | "invalid-phone"
  | "duplicate-phone";

export interface ContactIssue {
  rowIndex: number; // 1-based spreadsheet row (header row + offset)
  kind: ContactIssueKind;
  detail: string;
}

export interface ClassificationResult {
  contacts: NormalizedContact[];
  issues: ContactIssue[];
  duplicates: DuplicateGroup[];
}

export interface DuplicateGroup {
  phone: string;
  ids: string[];
}

/* ------------------------- Templates ------------------------- */

/** A template-variable chip shown under the template editor.
 * `count` is the number of contacts with data in that column; null = always
 * available (e.g. {date}). */
export interface TemplateVarChip {
  /** Variable name without braces, e.g. "name". */
  name: string;
  /** Column label, e.g. "Full Name". */
  label: string;
  count: number | null;
}

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSaveRequest {
  id?: string; // present when editing an existing template
  name: string;
  body: string;
}

/* ------------------------- Queue / sending hand-off ------------------------- */

export type QueueStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export interface QueueItem {
  id: string;
  name: string;
  phone: string;
  message: string;
  status: QueueStatus;
}

/** A queue prepared and confirmed by the user, handed to the extension. */
export interface QueuePayload {
  sessionId: string;
  createdAt: string;
  sourceFile: string;
  templateName: string | null;
  items: QueueItem[];
}

export interface HandoffResult {
  accepted: boolean;
  message: string;
  /** How the queue was handed off, when accepted. */
  transport?: "localhost-http" | "native-messaging" | "file-export" | "none";
}

/** Full result of a hand-off: the outcome plus the normalized queue payload. */
export interface HandoffOutcome {
  result: HandoffResult;
  payload: QueuePayload;
}

export interface UpdateStatusRequest {
  sessionId: string;
  itemId: string;
  status: QueueStatus;
  error?: string;
}

/* ------------------------- IPC channel names ------------------------- */

export const IPC = {
  getSettings: "settings:get",
  setRootFolder: "settings:setRootFolder",
  pickFolder: "dialog:pickFolder",
  discoverToday: "files:discoverToday",
  readWorkbook: "files:readWorkbook",
  lookupMapping: "mapping:lookup",
  saveMapping: "mapping:save",
  listTemplates: "templates:list",
  saveTemplate: "templates:save",
  deleteTemplate: "templates:delete",
  handoffQueue: "queue:handoff",
  updateQueueStatus: "queue:updateStatus",
  loadLastQueue: "queue:loadLast",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
