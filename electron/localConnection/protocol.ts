import type { QueueItem } from "../shared/types";
import { phoneKey } from "../shared/phone";

export const PROTOCOL_VERSION = 1;
export const PAIRING_PORT_MIN = 49152;
export const PAIRING_PORT_COUNT = 16384;
export const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
const PAIRING_SECRET_SPACE = Math.floor(PAIRING_ALPHABET.length ** 8 / PAIRING_PORT_COUNT);
export const pairingSecretSpace = PAIRING_SECRET_SPACE;
export type SenderStatus = "pending" | "sending" | "sent" | "failed" | "skipped" | "completed" | "stopped";
export interface OutgoingMessage { id: string; name: string; phone: string; message: string }
export type ExtensionMessage =
  | { type: "PAIR"; pairingCode: string }
  | { type: "AUTH"; deviceId: string; sessionToken: string }
  | { type: "PONG"; requestId: string }
  | { type: "PING"; requestId: string }
  | { type: "STATUS"; requestId: string; messageId?: string; status: SenderStatus; errorCode?: string }
  | { type: "ERROR"; requestId: string; messageId?: string; code: string; message: string };
export type ManagerMessage =
  | { type: "PAIR_SUCCESS"; deviceId: string; sessionToken: string; serverUrl: string; protocolVersion: 1 }
  | { type: "PAIR_REJECTED"; code: string; message: string }
  | { type: "AUTH_SUCCESS"; protocolVersion: 1 }
  | { type: "AUTH_REJECTED"; code: string; message: string }
  | { type: "PONG"; requestId: string }
  | { type: "START_SENDING"; requestId: string; messages: OutgoingMessage[] }
  | { type: "STOP_SENDING"; requestId: string }
  | { type: "PING"; requestId: string }
  | { type: "DISCONNECT"; code: string; message: string };

const statuses = new Set<SenderStatus>(["pending", "sending", "sent", "failed", "skipped", "completed", "stopped"]);
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
/** Decode the ephemeral loopback port from the pairing code before connecting. */
export function pairingPortFromCode(code: string): number | null {
  if (code.length !== 9 || code[4] !== "-") return null;
  const normalized = code.replace("-", "");
  if (normalized.length !== 8) return null;
  let value = 0;
  for (const char of normalized) {
    const digit = PAIRING_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * PAIRING_ALPHABET.length + digit;
  }
  const offset = Math.floor(value / PAIRING_SECRET_SPACE);
  return offset < PAIRING_PORT_COUNT ? PAIRING_PORT_MIN + offset : null;
}
export function parseExtensionMessage(raw: unknown): ExtensionMessage {
  if (!object(raw) || typeof raw.type !== "string") throw new Error("Malformed protocol message.");
  const v = raw;
  if (v.type === "PAIR" && onlyKeys(v, ["type", "pairingCode"]) && typeof v.pairingCode === "string" && /^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}-[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}$/.test(v.pairingCode)) return v as ExtensionMessage;
  if (v.type === "AUTH" && onlyKeys(v, ["type", "deviceId", "sessionToken"]) && typeof v.deviceId === "string" && v.deviceId.length <= 100 && typeof v.sessionToken === "string" && v.sessionToken.length >= 40 && v.sessionToken.length <= 200) return v as ExtensionMessage;
  if (v.type === "PONG" && onlyKeys(v, ["type", "requestId"]) && typeof v.requestId === "string" && v.requestId.length > 0 && v.requestId.length <= 100) return v as ExtensionMessage;
  if (["PING", "STATUS", "ERROR"].includes(String(v.type)) && typeof v.requestId === "string" && v.requestId.length > 0 && v.requestId.length <= 100) {
    if (v.type === "PING" && onlyKeys(v, ["type", "requestId"])) return v as ExtensionMessage;
    if (!onlyKeys(v, v.type === "STATUS" ? ["type", "requestId", "messageId", "status", "errorCode"] : ["type", "requestId", "messageId", "code", "message"])) throw new Error("Unexpected protocol fields.");
    if (v.messageId !== undefined && (typeof v.messageId !== "string" || v.messageId.length > 100)) throw new Error("Invalid messageId.");
    if (v.type === "STATUS" && typeof v.status === "string" && statuses.has(v.status as SenderStatus) && (v.errorCode === undefined || (typeof v.errorCode === "string" && v.errorCode.length <= 100))) return v as ExtensionMessage;
    if (v.type === "ERROR" && typeof v.code === "string" && v.code.length <= 100 && typeof v.message === "string" && v.message.length <= 500) return v as ExtensionMessage;
  }
  throw new Error("Unknown command or invalid protocol schema.");
}

export function validateQueue(items: unknown): OutgoingMessage[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 5000) throw new Error("Queue must contain 1 to 5,000 messages.");
  const ids = new Set<string>();
  const phones = new Set<string>();
  const clean = items.map((item): OutgoingMessage => {
    if (!object(item)) throw new Error("Invalid queue record.");
    const { id, name, phone, message } = item;
    if (typeof id !== "string" || !id || id.length > 100 || ids.has(id) || typeof name !== "string" || !name.trim() || name.length > 200 || typeof phone !== "string" || !/^\+?[0-9 ()-]{10,24}$/.test(phone) || phone.replace(/\D/g, "").length < 10 || phone.replace(/\D/g, "").length > 15 || phones.has(phoneKey(phone)) || typeof message !== "string" || !message.trim() || message.length > 5000) throw new Error("Queue contains an invalid or duplicate record.");
    ids.add(id); phones.add(phoneKey(phone)); return { id, name, phone, message };
  });
  return clean;
}

export type QueueMessage = Pick<QueueItem, "id" | "name" | "phone" | "message">;
