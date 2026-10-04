import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import WebSocket, { WebSocketServer } from "ws";
import { PAIRING_ALPHABET, PAIRING_PORT_COUNT, PAIRING_PORT_MIN, PROTOCOL_VERSION, parseExtensionMessage, validateQueue, type ManagerMessage, type OutgoingMessage } from "./protocol";

export interface PairingState {
  paired: boolean;
  connected: boolean;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  endpoint: string | null;
  error: string | null;
}
interface SavedCredential { deviceId: string; encryptedToken: string; port?: number; extensionId?: string; activeRequests?: Array<[string, string[]]> }
type EventHandler = (type: "state" | "status" | "error", payload: unknown) => void;
const CODE_TTL_MS = 5 * 60_000;
const PAIRING_SECRET_SPACE = Math.floor(PAIRING_ALPHABET.length ** 8 / PAIRING_PORT_COUNT);

/** A 127.0.0.1-only WebSocket endpoint. Credentials are DPAPI-protected by
 * Electron safeStorage on Windows and are scoped to this user profile. */
export class PairingServer {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private state: PairingState = { paired: false, connected: false, pairingCode: null, pairingExpiresAt: null, endpoint: null, error: null };
  private credential: SavedCredential | null = null;
  private pairingTimer: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, (ok: boolean) => void>();
  private activeRequests = new Map<string, Set<string>>();
  private pairingAttempts = 0;
  private readonly credentialPath: string;

  constructor(userDataDir: string, private readonly onEvent: EventHandler) {
    this.credentialPath = path.join(userDataDir, "parthsender-credential.json");
    this.loadCredential();
  }

  getState(): PairingState { return { ...this.state, pairingCode: this.state.pairingCode }; }

  async start(): Promise<void> {
    if (this.wss) return;
    if (process.platform !== "win32" || !safeStorage.isEncryptionAvailable()) {
      this.update({ error: "Secure credential storage is unavailable on this Windows account." }); return;
    }
    const preferredPort = this.credential?.port;
    const candidates = preferredPort ? [preferredPort] : Array.from({ length: 80 }, () => crypto.randomInt(PAIRING_PORT_MIN, PAIRING_PORT_MIN + PAIRING_PORT_COUNT));
    let lastError: unknown;
    for (const port of candidates) {
      const candidate = new WebSocketServer({ host: "127.0.0.1", port, maxPayload: 1024 * 1024, perMessageDeflate: false, verifyClient: (info, done) => {
        const origin = info.origin ?? "";
        const extensionId = origin.match(/^chrome-extension:\/\/([a-p]{32})\/?$/)?.[1];
        const allowed = !!extensionId && (this.credential ? extensionId === this.credential.extensionId : !!this.state.pairingCode);
        done(allowed, 403, "Unrecognized extension origin or pairing is not active");
      } });
      try {
        await new Promise<void>((resolve, reject) => { candidate.once("listening", resolve); candidate.once("error", reject); });
        this.wss = candidate;
        candidate.on("connection", (socket, request) => this.handleConnection(socket, request.headers.origin ?? ""));
        candidate.on("error", (error) => this.update({ error: `Local WebSocket server error: ${error.message}` }));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        candidate.close();
        if (preferredPort) break;
      }
    }
    if (!this.wss) {
      this.update({ error: `Local WebSocket server could not start: ${lastError instanceof Error ? lastError.message : "no available loopback port"}` });
      return;
    }
    const address = this.wss?.address();
    if (address && typeof address === "object") {
      if (this.credential) { this.credential.port = address.port; this.persistCredential(); }
      this.update({ endpoint: `ws://127.0.0.1:${address.port}` });
    }
  }

  async close(): Promise<void> {
    this.cancelPairing();
    this.socket?.close(1000, "Manager closing"); this.socket = null;
    await new Promise<void>((resolve) => this.wss ? this.wss.close(() => resolve()) : resolve());
    this.wss = null;
  }

  beginPairing(): PairingState {
    if (!this.wss || !this.state.endpoint) throw new Error(this.state.error ?? "Local connection server is not ready.");
    if (this.credential) throw new Error("Disconnect the currently paired device before starting a new pairing.");
    this.cancelPairing();
    const port = Number(new URL(this.state.endpoint).port);
    const encodedValue = (port - PAIRING_PORT_MIN) * PAIRING_SECRET_SPACE + crypto.randomInt(PAIRING_SECRET_SPACE);
    let remaining = encodedValue;
    let encoded = "";
    for (let i = 0; i < 8; i++) { encoded = PAIRING_ALPHABET[remaining % PAIRING_ALPHABET.length] + encoded; remaining = Math.floor(remaining / PAIRING_ALPHABET.length); }
    const code = `${encoded.slice(0, 4)}-${encoded.slice(4)}`;
    this.update({ pairingCode: code, pairingExpiresAt: Date.now() + CODE_TTL_MS, error: null });
    this.pairingAttempts = 0;
    this.pairingTimer = setTimeout(() => {
      this.update({ pairingCode: null, pairingExpiresAt: null, error: "Pairing code expired. Generate a new code." });
    }, CODE_TTL_MS);
    return this.getState();
  }

  cancelPairing(): void {
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = null;
    this.update({ pairingCode: null, pairingExpiresAt: null });
    if (!this.credential) this.socket?.close(1000, "Pairing canceled");
  }

  disconnect(): void {
    this.cancelPairing();
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ type: "DISCONNECT", code: "USER_DISCONNECTED", message: "Pair again to reconnect." });
    this.socket?.close(1000, "Disconnected by user"); this.socket = null;
    for (const finish of this.pendingRequests.values()) finish(false);
    this.pendingRequests.clear();
    this.activeRequests.clear();
    this.credential = null;
    try { fs.rmSync(this.credentialPath, { force: true }); } catch { /* revoke in memory regardless */ }
    this.update({ paired: false, connected: false, error: null });
  }

  ping(): Promise<boolean> {
    if (!this.isAuthenticatedSocket()) return Promise.resolve(false);
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pendingRequests.delete(requestId); resolve(false); }, 3000);
      this.pendingRequests.set(requestId, (ok) => { clearTimeout(timer); this.pendingRequests.delete(requestId); resolve(ok); });
      try { this.send({ type: "PING", requestId }); } catch { this.pendingRequests.get(requestId)?.(false); }
    });
  }

  startSending(rawMessages: unknown): string {
    if (!this.isAuthenticatedSocket()) throw new Error("ParthSender is not connected.");
    const messages = validateQueue(rawMessages);
    const requestId = crypto.randomUUID();
    this.activeRequests.set(requestId, new Set(messages.map((message) => message.id)));
    try { this.persistCredential(); }
    catch (error) { this.activeRequests.delete(requestId); throw new Error(`Could not persist sending state: ${error instanceof Error ? error.message : "unknown error"}`); }
    this.send({ type: "START_SENDING", requestId, messages });
    return requestId;
  }

  stopSending(requestId: string): boolean {
    if (!this.isAuthenticatedSocket() || !this.activeRequests.has(requestId)) return false;
    this.send({ type: "STOP_SENDING", requestId });
    return true;
  }

  private handleConnection(socket: WebSocket, origin: string): void {
    if (!this.state.pairingCode && !this.credential) { socket.close(1008, "Pairing is not active"); return; }
    if (!this.credential) {
      this.socket?.close(4001, "Replaced by a new pairing attempt");
      this.socket = socket;
      this.update({ connected: false, error: null });
    }
    socket.on("message", (data) => {
      let parsed: unknown;
      try { parsed = JSON.parse(data.toString()); }
      catch { socket.close(1007, "Malformed JSON"); this.update({ error: "ParthSender sent invalid JSON." }); return; }
      let message;
      try { message = parseExtensionMessage(parsed); }
      catch (e) { socket.close(1008, "Invalid protocol message"); this.update({ error: e instanceof Error ? e.message : "Invalid protocol message." }); return; }
      this.handleMessage(socket, origin, message);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const finish of this.pendingRequests.values()) finish(false);
      this.pendingRequests.clear();
      this.update({ connected: false, error: this.state.paired ? "Connection lost. Trying to reconnect…" : this.state.error });
    });
    socket.on("error", () => { if (this.socket === socket) this.update({ connected: false, error: "Connection lost. Trying to reconnect…" }); });
  }

  private handleMessage(socket: WebSocket, origin: string, msg: ReturnType<typeof parseExtensionMessage>): void {
    if (msg.type === "PAIR") {
      if (!this.state.pairingCode || Date.now() > (this.state.pairingExpiresAt ?? 0) || msg.pairingCode !== this.state.pairingCode) {
        this.pairingAttempts++;
        if (this.pairingAttempts >= 5) this.cancelPairing();
        this.send({ type: "PAIR_REJECTED", code: "PAIRING_INVALID", message: "Pairing code is invalid or expired." }, socket); return;
      }
      const deviceId = crypto.randomUUID();
      const token = crypto.randomBytes(48).toString("base64url");
      const extensionId = origin.match(/^chrome-extension:\/\/([a-p]{32})\/?$/)?.[1];
      if (!extensionId) { this.send({ type: "PAIR_REJECTED", code: "ORIGIN_REJECTED", message: "Pairing is allowed only from a Chrome extension." }, socket); return; }
      this.credential = { deviceId, encryptedToken: safeStorage.encryptString(token).toString("base64"), extensionId, activeRequests: [] };
      this.credential.port = Number(new URL(this.state.endpoint!).port);
      try { this.persistCredential(); }
      catch { this.credential = null; this.send({ type: "PAIR_REJECTED", code: "CREDENTIAL_STORE_FAILED", message: "Could not save the secure device credential." }, socket); return; }
      this.cancelPairing();
      this.update({ paired: true, connected: true, error: null });
      this.send({ type: "PAIR_SUCCESS", deviceId, sessionToken: token, serverUrl: this.state.endpoint!, protocolVersion: PROTOCOL_VERSION }, socket);
      return;
    }
    if (msg.type === "AUTH") {
      const token = this.credential ? safeStorage.decryptString(Buffer.from(this.credential.encryptedToken, "base64")) : "";
      const supplied = Buffer.from(msg.sessionToken);
      const expected = Buffer.from(token);
      if (!this.credential || msg.deviceId !== this.credential.deviceId || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        this.send({ type: "AUTH_REJECTED", code: "AUTH_FAILED", message: "ParthSender authentication was rejected. Pair again." }, socket);
        this.credential = null;
        this.activeRequests.clear();
        try { fs.rmSync(this.credentialPath, { force: true }); } catch { /* invalidate in memory regardless */ }
        this.update({ paired: false, connected: false, error: "ParthSender authentication failed. Pair again." });
        socket.close(1008, "Authentication failed"); return;
      }
      const oldSocket = this.socket;
      this.socket = socket;
      this.update({ paired: true, connected: true, error: null });
      this.send({ type: "AUTH_SUCCESS", protocolVersion: PROTOCOL_VERSION }, socket);
      if (oldSocket && oldSocket !== socket) oldSocket.close(4001, "Replaced by authenticated extension connection");
      return;
    }
    if (!this.state.connected || socket !== this.socket) { socket.close(1008, "Authenticate first"); return; }
    if (msg.type === "PING") { this.send({ type: "PONG", requestId: msg.requestId }, socket); return; }
    if (msg.type === "PONG") { this.pendingRequests.get(msg.requestId)?.(true); return; }
    if (msg.type === "STATUS") {
      const messageIds = this.activeRequests.get(msg.requestId);
      if (!messageIds || (msg.messageId && !messageIds.has(msg.messageId))) { socket.close(1008, "Unrecognized status update"); return; }
      this.onEvent("status", msg);
      if (msg.messageId && ["sent", "failed", "skipped"].includes(msg.status)) messageIds.delete(msg.messageId);
      if (msg.status === "completed" || msg.status === "stopped") this.activeRequests.delete(msg.requestId);
      this.persistCredential();
      return;
    }
    if (msg.type === "ERROR") {
      if (!this.activeRequests.has(msg.requestId)) { socket.close(1008, "Unrecognized error update"); return; }
      this.onEvent("error", msg);
    }
  }

  private send(message: ManagerMessage, socket = this.socket): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("ParthSender connection was lost before the message was sent.");
    socket.send(JSON.stringify(message));
  }
  private isAuthenticatedSocket(): boolean { return !!this.socket && this.socket.readyState === WebSocket.OPEN && this.state.connected && this.state.paired; }
  private update(patch: Partial<PairingState>): void { this.state = { ...this.state, ...patch }; this.onEvent("state", this.getState()); }
  private loadCredential(): void {
    try {
      const data = JSON.parse(fs.readFileSync(this.credentialPath, "utf8")) as SavedCredential;
      if (typeof data.deviceId === "string" && typeof data.encryptedToken === "string") {
        this.credential = data;
        for (const [requestId, ids] of data.activeRequests ?? []) if (typeof requestId === "string" && Array.isArray(ids)) this.activeRequests.set(requestId, new Set(ids.filter((id) => typeof id === "string")));
      }
    } catch { this.credential = null; }
    this.state.paired = !!this.credential;
  }

  private persistCredential(): void {
    if (!this.credential) return;
    this.credential.activeRequests = [...this.activeRequests.entries()].map(([id, ids]) => [id, [...ids]]);
    fs.mkdirSync(path.dirname(this.credentialPath), { recursive: true });
    fs.writeFileSync(this.credentialPath, JSON.stringify(this.credential), { encoding: "utf8", mode: 0o600 });
  }
}
