# ParthSeva Manager ↔ ParthSender protocol v1

This protocol is for a trusted Chrome extension adapter calling the existing
ParthSender sender. The Manager endpoint binds to `127.0.0.1` on a dynamically
selected port, reused for this installation when available. Pairing is
accepted only from a Chrome extension origin; the first successful origin is
bound to the installation and required for reconnects. No contact data is sent
to external services.

## Pairing

Manager shows a cryptographically random, one-use `XXXX-XXXX` code with a five
minute expiry. The eight-character code encodes the randomly selected dynamic
loopback port plus independent random secret bits, so the extension can derive
the port before opening its first socket; the user only types the code. Use
alphabet `ABCDEFGHJKLMNPQRTUVWXYZ2346789` (base 30). Interpret the eight
characters as a base-30 integer `n`; set `secretSpace = floor(30^8 / 16384)`,
then `port = 49152 + floor(n / secretSpace)`. Connect to
`ws://127.0.0.1:<port>` and send
`{"type":"PAIR","pairingCode":"..."}`. Success returns
`PAIR_SUCCESS` with `deviceId`, 384-bit random `sessionToken`, `serverUrl`, and
`protocolVersion: 1`. The extension must persist URL, device ID, and token in
`chrome.storage.local`; the Manager stores the token encrypted with Electron
`safeStorage` (Windows DPAPI). The Chrome extension origin is saved with the
credential. The pairing code is then invalid. Bad codes are rate-limited to
five attempts per code.

On later launches the extension reconnects to its stored URL and sends
`{"type":"AUTH","deviceId":"...","sessionToken":"..."}`. It receives
`AUTH_SUCCESS` or `AUTH_REJECTED`. `DISCONNECT` from Manager revokes the stored
Manager credential; the extension should then clear its saved credentials.
An AUTH rejection also requires clearing credentials and asking the user to
pair again.

## Runtime messages

Manager → extension:

```json
{"type":"PING","requestId":"uuid"}
{"type":"START_SENDING","requestId":"uuid","messages":[{"id":"message-001","name":"Rahul Sharma","phone":"9876543210","message":"Approved final text"}]}
{"type":"STOP_SENDING","requestId":"uuid"}
{"type":"DISCONNECT","code":"USER_DISCONNECTED","message":"Pair again to reconnect"}
```

Extension → Manager:

```json
{"type":"PONG","requestId":"uuid"}
{"type":"STATUS","requestId":"uuid","messageId":"message-001","status":"sent"}
{"type":"STATUS","requestId":"uuid","status":"completed"}
{"type":"ERROR","requestId":"uuid","messageId":"message-001","code":"SEND_FAILED","message":"Could not send this message"}
```

Statuses: `pending`, `sending`, `sent`, `failed`, `skipped`, `completed`,
`stopped`. `STOP_SENDING` means stop before the next message; finish any active
sender operation consistently. Manager validates schemas, request IDs and
message IDs, caps frames at 1 MiB, and does not transform message text.

## Required extension adapter

No ParthSender extension source is included in this repository. Its owner must
add the adapter without replacing manual UI or sender logic. The MV3 service
worker should own/reconnect the WebSocket and serialize START/STOP operations
into the existing sender. Queue messages are final approved content; do not
rewrite them. Emit statuses per item and terminal completed/stopped. On socket
loss, stop beginning new messages and leave in-flight sending consistent.
Clear the stored token when Manager sends DISCONNECT or AUTH_REJECTED. Keep
phone numbers and message content out of logs and URLs.

The extension ID is not guessed or hardcoded: the first successful pairing
binds the origin reported by Chrome, and reconnects must come from that same
extension origin.

## Current verification limits

The extension repository is located alongside this Manager repository. Its
service-worker adapter and popup already existed in an earlier Native
Messaging draft; the update in this integration replaces endpoint discovery
with the code-derived local WebSocket URL while continuing to call the
extension's existing queue sender.
