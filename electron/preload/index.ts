import { contextBridge, ipcRenderer } from "electron";
import type {
  DiscoveryResult,
  FileInfo,
  HandoffOutcome,
  MappingLookupRequest,
  MappingLookupResult,
  QueuePayload,
  SaveMappingRequest,
  Settings,
  SheetSummary,
  TemplateSaveRequest,
  UpdateStatusRequest,
  ValidationResult,
  WorkbookInfo,
  MessageTemplate,
} from "../shared/types";

/**
 * Secure preload bridge.
 *
 * The renderer gets ONLY the small, typed functions below — no Node.js, no
 * unrestricted fs, no raw ipcRenderer. Every call goes to a fixed channel
 * with validated handlers on the main side.
 *
 * IMPORTANT: sandboxed preloads cannot require app-relative modules, so the
 * channel map lives here. Keep in sync with IPC in ../shared/types.ts (the
 * type-only import below is erased at compile time and does not load at
 * runtime).
 */

const IPC = {
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
  senderGetState: "sender:getState",
  senderPair: "sender:pair",
  senderCancelPair: "sender:cancelPair",
  senderDisconnect: "sender:disconnect",
  senderPing: "sender:ping",
  senderStart: "sender:start",
  senderStop: "sender:stop",
} as const satisfies (typeof import("../shared/types"))["IPC"];

const api = {
  getSettings: (): Promise<{ settings: Settings }> =>
    ipcRenderer.invoke(IPC.getSettings),

  setRootFolder: (path: string): Promise<ValidationResult> =>
    ipcRenderer.invoke(IPC.setRootFolder, { path }),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFolder),

  discoverToday: (): Promise<DiscoveryResult | { error: string }> =>
    ipcRenderer.invoke(IPC.discoverToday),

  readWorkbookInfo: (file: FileInfo): Promise<WorkbookInfo | { error: string }> =>
    ipcRenderer.invoke(IPC.readWorkbook, { file }),

  readSheet: (file: FileInfo, sheetIndex: number): Promise<SheetSummary | { error: string }> =>
    ipcRenderer.invoke(IPC.readWorkbook, { file, sheetIndex }),

  lookupMapping: (req: MappingLookupRequest): Promise<MappingLookupResult> =>
    ipcRenderer.invoke(IPC.lookupMapping, req),

  saveMapping: (req: SaveMappingRequest): Promise<ValidationResult> =>
    ipcRenderer.invoke(IPC.saveMapping, req),

  listTemplates: (): Promise<MessageTemplate[]> => ipcRenderer.invoke(IPC.listTemplates),

  saveTemplate: (req: TemplateSaveRequest): Promise<ValidationResult> =>
    ipcRenderer.invoke(IPC.saveTemplate, req),

  deleteTemplate: (id: string): Promise<ValidationResult> =>
    ipcRenderer.invoke(IPC.deleteTemplate, id),

  handoffQueue: (payload: QueuePayload): Promise<HandoffOutcome> =>
    ipcRenderer.invoke(IPC.handoffQueue, payload),

  updateQueueStatus: (req: UpdateStatusRequest): Promise<QueuePayload | null> =>
    ipcRenderer.invoke(IPC.updateQueueStatus, req),

  loadLastQueue: (): Promise<QueuePayload | null> =>
    ipcRenderer.invoke(IPC.loadLastQueue),

  senderGetState: (): Promise<unknown> => ipcRenderer.invoke(IPC.senderGetState),
  senderPair: (): Promise<unknown> => ipcRenderer.invoke(IPC.senderPair),
  senderCancelPair: (): Promise<boolean> => ipcRenderer.invoke(IPC.senderCancelPair),
  senderDisconnect: (): Promise<boolean> => ipcRenderer.invoke(IPC.senderDisconnect),
  senderPing: (): Promise<boolean> => ipcRenderer.invoke(IPC.senderPing),
  senderStart: (messages: Array<Pick<import("../shared/types").QueueItem, "id" | "name" | "phone" | "message">>): Promise<string> => ipcRenderer.invoke(IPC.senderStart, { messages }),
  senderStop: (requestId: string): Promise<boolean> => ipcRenderer.invoke(IPC.senderStop, { requestId }),
  onSenderEvent: (callback: (event: { type: string; payload: unknown }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload as { type: string; payload: unknown });
    ipcRenderer.on("sender:event", listener);
    return () => ipcRenderer.removeListener("sender:event", listener);
  },
};

export type ParthSevaApi = typeof api;

contextBridge.exposeInMainWorld("parthseva", api);
