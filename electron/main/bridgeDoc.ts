import path from "node:path";
import fs from "node:fs";

/**
 * Chrome extension hand-off documentation.
 *
 * This file is generated into the app's userData directory on first run so
 * the extension author (or the user) always has the exact hand-off format
 * available on the machine that needs it.
 */
export const EXTENSION_BRIDGE_DOC = `# ParthSeva Manager - Extension Queue Hand-off

ParthSeva Manager prepares and manages the message queue. It does NOT send
messages. Your existing Chrome extension stays responsible for opening the
messaging service and sending.

## Queue file format

When the user confirms sending, the app writes a JSON file to:

    <userData>/queue-sessions/<sessionId>.json

with this shape:

{
  "sessionId": "q20261002-142233-a1b2c3",
  "createdAt": "2026-10-02T14:22:33.000Z",
  "sourceFile": "Birthday List 02-10-2026.xlsx",
  "templateName": "Birthday",
  "items": [
    {
      "id": "i1",
      "name": "Rahul Sharma",
      "phone": "9876543210",
      "message": "Happy Birthday Rahul Sharma!",
      "status": "pending" | "sending" | "sent" | "failed" | "skipped"
    }
  ]
}

## How the extension can consume the queue

Option A - Poll the queue folder
  Watch <userData>/queue-sessions/ for new files with status "pending" items.

Option B - Localhost API (if your extension already exposes one)
  The app probes 127.0.0.1 on ports 57321-57323 for GET /ping before writing.
  If your extension answers /ping, the app POSTs the JSON above to /queue.

Option C - Native messaging
  If a native messaging host manifest is registered, the app reports it and
  the host can read the same queue files.

## Security rules

- Local only: no data ever leaves this machine.
- The queue contains only: id, name, phone, message, status.
- The app never auto-sends; the user confirms every batch explicitly.
`;

export function writeBridgeDoc(userDataDir: string): void {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "EXTENSION_BRIDGE.md"),
      EXTENSION_BRIDGE_DOC,
      "utf-8",
    );
  } catch {
    // Non-fatal: the doc is a convenience, not a requirement.
  }
}
