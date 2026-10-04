import path from "node:path";
import fs from "node:fs";

/**
 * Chrome extension hand-off documentation.
 *
 * This file is generated into the app's userData directory on first run so
 * the extension author (or the user) always has the exact hand-off format
 * available on the machine that needs it.
 */
export const EXTENSION_BRIDGE_DOC = `# ParthSeva Manager - ParthSender integration

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

## WebSocket pairing status

The app implements protocol v1 over a loopback-only WebSocket server. Pair once
from the ParthSender extension, then it reconnects with a protected device
credential. The first Chrome extension origin that presents the one-time code
is bound to the installation for later authentication. See
PARTHSENDER_WEBSOCKET_PROTOCOL.md for the extension adapter contract.

## Security rules

- Local only: no data ever leaves this machine.
- The queue contains only: id, name, phone, message, status.
- The app never auto-sends; the user reviews the queue and explicitly confirms.
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
