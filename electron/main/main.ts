import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import type { SettingsStore } from "./settings";
import { SettingsStore as SettingsStoreImpl } from "./settings";
import type { JsonStore } from "./store";
import { JsonStore as JsonStoreImpl } from "./store";
import type { QueueSessionStore } from "./handoff";
import { QueueSessionStore as QueueSessionStoreImpl } from "./handoff";
import { registerIpcHandlers, type IpcDeps } from "./ipc";
import { writeBridgeDoc } from "./bridgeDoc";

/**
 * Electron main process entry.
 * Owns all filesystem access. The renderer only sees the IPC surface.
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

let mainWindow: BrowserWindow | null = null;
let settings: SettingsStore;
let mappings: JsonStore<Record<string, SavedMappingEntry>>;
let templates: JsonStore<SavedTemplate[]>;
let sessions: QueueSessionStore;

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    title: "ParthSeva Manager",
    backgroundColor: "#f6f7f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow http(s) links to open outside the app shell.
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const userDataDir = app.getPath("userData");
  settings = new SettingsStoreImpl(userDataDir);
  mappings = new JsonStoreImpl<Record<string, SavedMappingEntry>>(userDataDir, "column-mappings.json");
  templates = new JsonStoreImpl<SavedTemplate[]>(userDataDir, "templates.json");
  sessions = new QueueSessionStoreImpl(userDataDir);

  writeBridgeDoc(userDataDir);
  registerIpcHandlers({ settings, mappings, templates, sessions } as IpcDeps);

  if (process.env.PARTHSEVA_SMOKE === "1") {
    // Smoke test: verify the main process boots, stores load, IPC registers,
    // then exit without opening a window. Used by `npm run smoke`.
    const result = {
      userData: app.getPath("userData"),
      rootConfigured: settings.settings.rootFolder,
    };
    console.log("SMOKE_OK", JSON.stringify(result));
    setTimeout(() => app.exit(0), 300);
    return;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
