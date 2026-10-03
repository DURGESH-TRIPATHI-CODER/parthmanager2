import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  HandoffOutcome,
  HandoffResult,
  QueueItem,
  QueuePayload,
  QueueStatus,
  UpdateStatusRequest,
} from "../shared/types";

/**
 * Extension hand-off layer.
 *
 * DESIGN CONSTRAINT (from the product spec):
 * The desktop app must NOT become a second WhatsApp automation system. The
 * existing Chrome extension stays responsible for opening the messaging
 * service and sending messages. This app only prepares and manages the queue.
 *
 * Before inventing any transport, we probe for a bridge the extension may
 * already expose:
 *   1. localhost HTTP API (extension native messaging or a localhost listener)
 *   2. Chrome Native Messaging host manifest registered on this machine
 *   3. Nothing found -> fall back to a clearly defined local queue file
 *
 * No data ever leaves this machine. Nothing is auto-sent: the queue is only
 * written after the user explicitly confirms on the "Messages Ready" screen.
 */

const BRIDGE_HTTP_PORTS = [57321, 57322, 57323]; // probed, never bound by us

/** Well-known Chrome Native Messaging host manifest locations (Windows + Linux). */
function nativeMessagingDirs(): string[] {
  const dirs: string[] = [];
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    for (const browser of ["Google/Chrome", "Microsoft/Edge", "Chromium"]) {
      dirs.push(
        path.join(localAppData, browser, "User Data", "Default", "NativeMessagingHosts"),
      );
    }
  }
  if (appData) {
    // Firefox-style location, in case the extension reused it.
    dirs.push(path.join(appData, "Mozilla", "NativeMessagingHosts"));
  }
  return dirs;
}

interface ProbeResult {
  transport: HandoffResult["transport"];
  detail: string;
}

/** Look for an existing communication mechanism without opening any port. */
async function probeExistingBridge(): Promise<ProbeResult | null> {
  // 1) Native messaging manifests installed by the extension.
  for (const dir of nativeMessagingDirs()) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir);
      const manifest = entries.find((f) => f.endsWith(".json"));
      if (manifest) {
        return {
          transport: "native-messaging",
          detail: `Native messaging host manifest found: ${manifest}`,
        };
      }
    } catch {
      // unreadable dir -> keep probing
    }
  }

  // 2) Localhost HTTP API already exposed by the extension.
  for (const port of BRIDGE_HTTP_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`, {
        signal: AbortSignal.timeout(250),
      });
      if (res.ok) {
        return { transport: "localhost-http", detail: `Bridge answered on port ${port}` };
      }
    } catch {
      // nothing listening -> expected in most installs
    }
  }

  return null;
}

/** Queue sessions are retained locally for the current session/day. */
export class QueueSessionStore {
  constructor(private readonly userDataDir: string) {}

  private sessionPath(sessionId: string): string {
    // Session ids are generated internally (timestamp+random), but stay strict.
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "");
    if (!safe || safe !== sessionId) throw new Error("Invalid session id");
    return path.join(this.userDataDir, "queue-sessions", `${safe}.json`);
  }

  save(payload: QueuePayload): void {
    const file = this.sessionPath(payload.sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  }

  load(sessionId: string): QueuePayload | null {
    try {
      const raw = fs.readFileSync(this.sessionPath(sessionId), "utf-8");
      return JSON.parse(raw) as QueuePayload;
    } catch {
      return null;
    }
  }

  latest(): QueuePayload | null {
    const dir = path.join(this.userDataDir, "queue-sessions");
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort();
      if (files.length === 0) return null;
      const raw = fs.readFileSync(path.join(dir, files[files.length - 1]), "utf-8");
      return JSON.parse(raw) as QueuePayload;
    } catch {
      return null;
    }
  }

  /** Apply a status update to one item and persist. */
  updateStatus(req: UpdateStatusRequest): QueuePayload | null {
    const payload = this.load(req.sessionId);
    if (!payload) return null;
    const item = payload.items.find((i) => i.id === req.itemId);
    if (!item) return null;
    item.status = req.status;
    if (req.error !== undefined) {
      (item as QueueItem & { error?: string }).error = req.error;
    }
    this.save(payload);
    return payload;
  }
}

/**
 * Hand the confirmed queue to the extension layer.
 *
 * Order of preference:
 *   1. An existing localhost API exposed by the extension.
 *   2. A registered native-messaging host.
 *   3. A clearly documented local queue file the extension can consume.
 *
 * We never send the queue anywhere remote and never auto-send.
 */
export async function handoffQueue(
  payload: QueuePayload,
  sessions: QueueSessionStore,
): Promise<HandoffOutcome> {
  // Defensive validation — the renderer is not trusted.
  const items = (payload.items ?? []).filter(
    (i): i is QueueItem =>
      typeof i?.id === "string" &&
      typeof i?.name === "string" &&
      typeof i?.phone === "string" &&
      typeof i?.message === "string",
  );
  if (items.length === 0) {
    return {
      result: { accepted: false, message: "Queue is empty — nothing to hand off." },
      payload,
    };
  }

  const clean: QueuePayload = {
    sessionId: payload.sessionId,
    createdAt: new Date().toISOString(),
    sourceFile: path.basename(String(payload.sourceFile ?? "")),
    templateName: payload.templateName ?? null,
    items: items.map((i) => ({
      id: i.id.slice(0, 64),
      name: i.name.slice(0, 200),
      phone: i.phone.slice(0, 32),
      message: i.message.slice(0, 2000),
      status: "pending" as QueueStatus,
    })),
  };

  const bridge = await probeExistingBridge();

  if (bridge?.transport === "localhost-http") {
    // POST the validated queue to the extension's existing local API.
    try {
      const res = await fetch("http://127.0.0.1:57321/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        sessions.save(clean);
        return {
          result: {
            accepted: true,
            message: `Queue accepted by extension bridge (${bridge.detail}).`,
            transport: "localhost-http",
          },
          payload: clean,
        };
      }
      return {
        result: {
          accepted: false,
          message: `Bridge answered /ping but rejected the queue (HTTP ${res.status}).`,
        },
        payload: clean,
      };
    } catch {
      // fall through to file-based hand-off
    }
  }

  // Native messaging and file fallback both persist the queue locally.
  sessions.save(clean);

  if (bridge?.transport === "native-messaging") {
    return {
      result: {
        accepted: true,
        message:
          "Queue saved locally. A native messaging host was detected; wire it to read this queue to complete the bridge.",
        transport: "native-messaging",
      },
      payload: clean,
    };
  }

  return {
    result: {
      accepted: false,
      message:
        "No existing extension bridge was found (no localhost API, no native messaging host). " +
        "The queue has been saved locally as the defined hand-off format — see docs/EXTENSION_BRIDGE.md.",
      transport: "file-export",
    },
    payload: clean,
  } as HandoffOutcome;
}
