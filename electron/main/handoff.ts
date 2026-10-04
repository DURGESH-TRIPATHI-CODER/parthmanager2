import fs from "node:fs";
import path from "node:path";
import type { HandoffOutcome, QueueItem, QueuePayload, QueueStatus, UpdateStatusRequest } from "../shared/types";

/** Locally persisted queue session storage. Delivery is performed by the
 * Native Messaging client, never by probing localhost or a queue-file watcher. */
export class QueueSessionStore {
  constructor(private readonly userDataDir: string) {}
  private sessionPath(id: string): string {
    const safe = id.replace(/[^A-Za-z0-9_-]/g, "");
    if (!safe || safe !== id) throw new Error("Invalid session id");
    return path.join(this.userDataDir, "queue-sessions", `${safe}.json`);
  }
  save(payload: QueuePayload): void {
    const file = this.sessionPath(payload.sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  }
  load(id: string): QueuePayload | null {
    try { return JSON.parse(fs.readFileSync(this.sessionPath(id), "utf8")) as QueuePayload; } catch { return null; }
  }
  latest(): QueuePayload | null {
    const dir = path.join(this.userDataDir, "queue-sessions");
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
      return files.length ? JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8")) as QueuePayload : null;
    } catch { return null; }
  }
  updateStatus(req: UpdateStatusRequest): QueuePayload | null {
    const payload = this.load(req.sessionId);
    if (!payload) return null;
    const item = payload.items.find((i) => i.id === req.itemId);
    if (!item) return null;
    item.status = req.status;
    if (req.error !== undefined) (item as QueueItem & { error?: string }).error = req.error;
    this.save(payload);
    return payload;
  }
}

/** Compatibility path for older callers. Persists only and never claims sent. */
export async function handoffQueue(payload: QueuePayload, sessions: QueueSessionStore): Promise<HandoffOutcome> {
  const items = (payload.items ?? []).filter((i): i is QueueItem =>
    typeof i?.id === "string" && typeof i?.name === "string" && typeof i?.phone === "string" && typeof i?.message === "string");
  const clean: QueuePayload = {
    sessionId: payload.sessionId,
    createdAt: new Date().toISOString(),
    sourceFile: path.basename(String(payload.sourceFile ?? "")),
    templateName: payload.templateName ?? null,
    items: items.map((i) => ({ id: i.id.slice(0, 64), name: i.name.slice(0, 200), phone: i.phone.slice(0, 32), message: i.message.slice(0, 2000), status: "pending" as QueueStatus })),
  };
  if (!clean.items.length) return { result: { accepted: false, message: "Queue is empty." }, payload };
  sessions.save(clean);
  return { result: { accepted: false, message: "Queue saved locally only; no delivery was attempted.", transport: "file-export" }, payload: clean };
}
