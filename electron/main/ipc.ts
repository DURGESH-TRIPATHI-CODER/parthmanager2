import fs from "node:fs";
import path from "node:path";
import { app, ipcMain, dialog, BrowserWindow } from "electron";
import type {
  DiscoveryResult,
  FileInfo,
  HandoffOutcome,
  MappingLookupRequest,
  MappingLookupResult,
  QueuePayload,
  SaveMappingRequest,
  SheetSummary,
  SevaDocxRequest,
  TemplateSaveRequest,
  UpdateStatusRequest,
  ValidationResult,
  WorkbookInfo,
} from "../shared/types";
import { IPC } from "../shared/types";
import type { SettingsStore } from "./settings";
import type { JsonStore } from "./store";
import type { QueueSessionStore } from "./handoff";
import {
  headerSignature,
  readSheet,
  readWorkbookInfo,
} from "./excel";
import { findFilesForDate } from "./fileFinder";
import { handoffQueue } from "./handoff";
import { buildSevaDocx } from "./sevaDocx";
import type { PairingServer } from "../localConnection/server";

/**
 * All IPC handlers. Every handler validates its inputs and returns plain
 * JSON-safe data; the renderer never receives Node primitives and never
 * touches the filesystem itself.
 */

interface SavedMappingEntry {
  headerRowIndex: number;
  mapping: Record<string, number>;
  savedAt: string;
}

interface SavedTemplate {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface IpcDeps {
  settings: SettingsStore;
  mappings: JsonStore<Record<string, SavedMappingEntry>>;
  templates: JsonStore<SavedTemplate[]>;
  sessions: QueueSessionStore;
  sender: PairingServer;
}

function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

function requireRoot(settings: SettingsStore): string {
  const root = settings.settings.rootFolder;
  if (!root) throw new Error("ParthSeva folder is not configured.");
  return root;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle(IPC.downloadParthSenderExtension, async (event) => {
    const sourcePath = app.isPackaged
      ? path.join(process.resourcesPath, "parthsender.zip")
      : path.join(app.getAppPath(), "public", "parthsender.zip");
    if (!fs.existsSync(sourcePath)) throw new Error("The ParthSender extension download is missing from this installation.");
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Save ParthSender extension",
      defaultPath: path.join(app.getPath("downloads"), "parthsender.zip"),
      filters: [{ name: "ZIP archive", extensions: ["zip"] }],
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.copyFile(sourcePath, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle(IPC.sevaSaveDocx, async (event, req: Partial<SevaDocxRequest>) => {
    if (!req || typeof req !== "object") throw new Error("Invalid document request.");
    if (req.text !== undefined && typeof req.text !== "string") throw new Error("Invalid document text.");
    if (req.text && req.text.length > 1_000_000) throw new Error("Document text is too long.");
    const sections = (req.sections ?? []).map((section) => ({
      heading: String(section?.heading ?? ""),
      entries: (Array.isArray(section?.entries) ? section.entries : []).map((entry) => ({
        name: String(entry?.name ?? ""),
        note: entry?.note === undefined ? undefined : String(entry.note),
        size: Number.isFinite(entry?.size) ? Number(entry.size) : undefined,
      })),
    }));
    const defaultName = typeof req.defaultName === "string" && req.defaultName.trim()
      ? req.defaultName.trim()
      : "Seva List";
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Save as Word document",
      defaultPath: path.join(app.getPath("downloads"), `${defaultName}.docx`),
      filters: [{ name: "Word document", extensions: ["docx"] }],
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    const docx = await buildSevaDocx({
      defaultName,
      date: req.date === undefined ? undefined : String(req.date),
      text: req.text,
      footer: req.footer === undefined ? undefined : String(req.footer),
      sections,
    });
    await fs.promises.writeFile(result.filePath, docx);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle(IPC.senderGetState, () => deps.sender.getState());
  ipcMain.handle(IPC.senderPair, () => deps.sender.beginPairing());
  ipcMain.handle(IPC.senderCancelPair, () => { deps.sender.cancelPairing(); return true; });
  ipcMain.handle(IPC.senderDisconnect, () => { deps.sender.disconnect(); return true; });
  ipcMain.handle(IPC.senderPing, async () => {
    try { return deps.sender.ping(); } catch { return false; }
  });
  ipcMain.handle(IPC.senderStart, async (_e, req: { messages?: unknown }) => {
    if (!Array.isArray(req?.messages)) throw new Error("Invalid message queue.");
    return deps.sender!.startSending(req.messages as never[]);
  });
  ipcMain.handle(IPC.senderStop, (_e, req: { requestId?: unknown }) => {
    if (typeof req?.requestId !== "string" || req.requestId.length > 100) throw new Error("Invalid requestId.");
    return deps.sender.stopSending(req.requestId);
  });
  ipcMain.handle(IPC.getSettings, () => {
    return { settings: deps.settings.settings };
  });

  ipcMain.handle(
    IPC.setRootFolder,
    (_e, req: { path?: unknown }): ValidationResult => {
      const p = typeof req?.path === "string" ? req.path.trim() : "";
      if (!p) return { ok: false, message: "No folder path provided." };
      try {
        const st = fs.statSync(p);
        if (!st.isDirectory()) return { ok: false, message: "Path is not a folder." };
        deps.settings.setRootFolder(p);
        return { ok: true, message: "ParthSeva folder saved." };
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        return {
          ok: false,
          message: code === "ENOENT" ? "Folder does not exist." : errMessage(err),
        };
      }
    },
  );

  ipcMain.handle(IPC.pickFolder, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Select your ParthSeva root folder",
          properties: ["openDirectory"],
          buttonLabel: "Use this folder",
        })
      : await dialog.showOpenDialog({
          title: "Select your ParthSeva root folder",
          properties: ["openDirectory"],
          buttonLabel: "Use this folder",
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.discoverToday, async (): Promise<DiscoveryResult | { error: string }> => {
    try {
      const root = deps.settings.settings.rootFolder;
      if (!root) {
        // First run: no error, just an empty result — nothing blocks.
        const today = new Date();
        return {
          dateISO: today.toISOString().slice(0, 10),
          monthName: "",
          monthFolder: "",
          files: [],
          notConfigured: true,
        };
      }
      return await findFilesForDate(root, new Date());
    } catch (err) {
      return { error: errMessage(err) };
    }
  });

  ipcMain.handle(
    IPC.readWorkbook,
    (_e, req: { file?: unknown; sheetIndex?: unknown }) => {
      try {
        if (!req || typeof req !== "object") throw new Error("Bad request");
        const fileInfo = req.file as Partial<FileInfo> | undefined;
        if (!fileInfo || typeof fileInfo.fullPath !== "string") {
          throw new Error("No file specified.");
        }
        // Only files inside the configured root folder may be opened.
        const root = requireRoot(deps.settings);
        const resolved = path.resolve(fileInfo.fullPath);
        if (!resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep) &&
            path.dirname(resolved).toLowerCase() !== root.toLowerCase()) {
          throw new Error("File is outside the configured ParthSeva folder.");
        }
        const kind: FileInfo["kind"] =
          fileInfo.kind === "xls" || fileInfo.kind === "csv" ? fileInfo.kind : "xlsx";
        const safeFile: FileInfo = {
          filename: path.basename(resolved),
          fullPath: resolved,
          kind,
          matchedDate: "",
        };
        if (typeof req.sheetIndex === "number") {
          return readSheet(safeFile, Math.max(0, Math.floor(req.sheetIndex)));
        }
        return readWorkbookInfo(safeFile);
      } catch (err) {
        return { error: errMessage(err) };
      }
    },
  );

  ipcMain.handle(IPC.lookupMapping, (_e, req: MappingLookupRequest): MappingLookupResult => {
    try {
      const signature = headerSignature(req?.headers ?? []);
      const all = deps.mappings.read() ?? {};
      const entry = all[signature];
      if (!entry || !entry.mapping) return { mapping: null };
      if (entry.headerRowIndex !== req.headerRowIndex) return { mapping: null };
      return { mapping: entry.mapping as MappingLookupResult["mapping"], savedAt: entry.savedAt };
    } catch {
      return { mapping: null };
    }
  });

  ipcMain.handle(IPC.saveMapping, (_e, req: SaveMappingRequest): ValidationResult => {
    try {
      if (!req || !Array.isArray(req.headers) || typeof req.mapping !== "object") {
        return { ok: false, message: "Bad mapping request." };
      }
      const signature = headerSignature(req.headers);
      const all = deps.mappings.read() ?? {};
      all[signature] = {
        headerRowIndex: req.headerRowIndex,
        mapping: req.mapping as Record<string, number>,
        savedAt: new Date().toISOString(),
      };
      deps.mappings.write(all);
      return { ok: true, message: "Mapping saved." };
    } catch (err) {
      return { ok: false, message: errMessage(err) };
    }
  });

  ipcMain.handle(IPC.listTemplates, () => {
    return deps.templates.read() ?? [];
  });

  ipcMain.handle(IPC.saveTemplate, (_e, req: TemplateSaveRequest): ValidationResult => {
    try {
      const name = typeof req?.name === "string" ? req.name.trim() : "";
      const body = typeof req?.body === "string" ? req.body : "";
      if (!name) return { ok: false, message: "Template needs a name." };
      if (!body.trim()) return { ok: false, message: "Template text is empty." };
      if (name.length > 100 || body.length > 5000) {
        return { ok: false, message: "Template too long." };
      }
      const list = deps.templates.read() ?? [];
      const now = new Date().toISOString();
      if (typeof req.id === "string" && req.id) {
        const existing = list.find((t) => t.id === req.id);
        if (!existing) return { ok: false, message: "Template not found." };
        existing.name = name;
        existing.body = body;
        existing.updatedAt = now;
      } else {
        list.push({
          id: `t${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          name,
          body,
          createdAt: now,
          updatedAt: now,
        });
      }
      deps.templates.write(list);
      return { ok: true, message: "Template saved." };
    } catch (err) {
      return { ok: false, message: errMessage(err) };
    }
  });

  ipcMain.handle(IPC.deleteTemplate, (_e, id: unknown): ValidationResult => {
    const idStr = typeof id === "string" ? id : "";
    if (!idStr) return { ok: false, message: "No template id provided." };
    const list = deps.templates.read() ?? [];
    deps.templates.write(list.filter((t) => t.id !== idStr));
    return { ok: true, message: "Template deleted." };
  });

  ipcMain.handle(IPC.handoffQueue, async (_e, payload: QueuePayload): Promise<HandoffOutcome> => {
    return handoffQueue(payload, deps.sessions);
  });

  ipcMain.handle(IPC.updateQueueStatus, (_e, req: UpdateStatusRequest) => {
    return deps.sessions.updateStatus(req);
  });

  ipcMain.handle(IPC.loadLastQueue, () => {
    return deps.sessions.latest();
  });
}
