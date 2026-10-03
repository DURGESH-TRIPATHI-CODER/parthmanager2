import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/types";
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
 */

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
};

export type ParthSevaApi = typeof api;

contextBridge.exposeInMainWorld("parthseva", api);
