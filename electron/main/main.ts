import path from "node:path";
import { app, BrowserWindow, powerMonitor, shell } from "electron";
import type { SettingsStore } from "./settings";
import { SettingsStore as SettingsStoreImpl } from "./settings";
import type { JsonStore } from "./store";
import { JsonStore as JsonStoreImpl } from "./store";
import type { QueueSessionStore } from "./handoff";
import { QueueSessionStore as QueueSessionStoreImpl } from "./handoff";
import { registerIpcHandlers, type IpcDeps } from "./ipc";
import { writeBridgeDoc } from "./bridgeDoc";
import { PairingServer } from "../localConnection/server";

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
let sender: PairingServer;

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function loadWindow(win: BrowserWindow): void {
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    title: "ParthSeva Manager",
    backgroundColor: "#f6f7f9",
    show: false, // avoid a white/blank window before the first paint
    autoHideMenuBar: true,
    webPreferences: {
      // __dirname is dist/electron/main — preload lives one level up.
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const win = mainWindow;

  // Show only once something has actually rendered (no white flash),
  // with a fallback so a slow first paint never leaves an invisible window.
  let shown = false;
  const showWindow = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once("ready-to-show", showWindow);
  setTimeout(showWindow, 5000);

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow http(s) links to open outside the app shell.
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Recovery: a crashed renderer must never leave a permanent white window.
  let loadRetries = 0;
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason !== "clean-exit" && loadRetries < 3) {
      loadRetries++;
      loadWindow(win);
    }
  });
  win.webContents.on("did-fail-load", (_e, code, description) => {
    // Ignore aborted loads (-3) caused by a navigation that replaced this one.
    if (code !== -3 && loadRetries < 3) {
      loadRetries++;
      console.error(`Renderer failed to load (${code}): ${description}, retrying…`);
      loadWindow(win);
    }
  });
  // An unresponsive renderer (e.g. right after waking from sleep) gets a reload.
  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;
  win.on("unresponsive", () => {
    unresponsiveTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload();
    }, 3000);
  });
  win.on("responsive", () => {
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
  });

  loadWindow(win);

  win.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const userDataDir = app.getPath("userData");
  settings = new SettingsStoreImpl(userDataDir);
  mappings = new JsonStoreImpl<Record<string, SavedMappingEntry>>(userDataDir, "column-mappings.json");
  templates = new JsonStoreImpl<SavedTemplate[]>(userDataDir, "templates.json");
  sessions = new QueueSessionStoreImpl(userDataDir);
  sender = new PairingServer(userDataDir, (type, payload) => mainWindow?.webContents.send("sender:event", { type, payload }));
  void sender.start();

  writeBridgeDoc(userDataDir);
  registerIpcHandlers({ settings, mappings, templates, sessions, sender } as IpcDeps);

  if (process.env.PARTHSEVA_SMOKE === "1") {
    // Smoke test: boot a hidden window, load the real renderer, and verify the
    // preload bridge is exposed and React mounted. Exits without showing UI.
    const result = {
      userData: app.getPath("userData"),
      rootConfigured: settings.settings.rootFolder,
    };
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const fail = (reason: string) => {
      console.error("SMOKE_FAIL", reason);
      app.exit(1);
    };
    const watchdog = setTimeout(() => fail("timeout waiting for renderer"), 15000);
    void win.loadFile(path.join(__dirname, "../../renderer/index.html"));
    win.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        win.webContents
          .executeJavaScript(
            `(() => {
              const t = document.body.innerText;
              const tl = t.toLowerCase();
              return JSON.stringify({
                bridge: typeof window.parthseva,
                bridgeKeys: window.parthseva ? Object.keys(window.parthseva).length : 0,
                mounted: (document.getElementById("root")?.childElementCount ?? 0) > 0,
                boundary: tl.includes("something went wrong"),
                bootSplash: !!document.getElementById("boot-splash"),
                text: t.slice(0, 120),
              });
            })()`,
          )
          .then((probe) => {
            clearTimeout(watchdog);
            const parsed = JSON.parse(probe) as Record<string, unknown>;
            if (parsed.bridge === "undefined") {
              fail(`preload bridge missing: ${probe}`);
              return;
            }
            if (parsed.boundary === true) {
              fail(`error boundary fired: ${probe}`);
              return;
            }
            console.log("SMOKE_OK", JSON.stringify({ ...result, probe: parsed }));
            app.exit(0);
          })
          .catch((e) => fail(String(e)));
      }, 900);
    });
    return;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // After the machine wakes from sleep, Chromium's renderer/GPU can come back
  // to a blank surface. Make sure the window is visible and, if the renderer
  // died while suspended, load it again.
  powerMonitor.on("resume", () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    setTimeout(() => {
      if (win.isDestroyed()) return;
      if (win.webContents.isCrashed()) {
        win.webContents.reload();
      } else if (!win.isVisible()) {
        win.show();
      }
      win.focus();
    }, 500);
  });
});

app.on("window-all-closed", () => {
  void sender?.close();
  if (process.platform !== "darwin") app.quit();
});
