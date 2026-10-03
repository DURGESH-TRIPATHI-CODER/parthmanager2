import type { ContactAction } from "./types";

/**
 * Normalize free-text "Action/Type" column values into one of three buckets.
 * Unknown values map to "review" — never guess.
 */
export function normalizeAction(raw: string | null | undefined): ContactAction {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "review";

  const compact = value.replace(/[^a-z]/g, ""); // ignore spaces, dashes, slashes

  const messageWords = [
    "message",
    "messages",
    "msg",
    "whatsapp",
    "whatsappmessage",
    "sms",
    "text",
    "textmessage",
  ];
  const callWords = ["call", "phone", "phonecall", "calling"];

  if (messageWords.some((w) => compact === w || compact.startsWith(w))) return "message";
  if (callWords.some((w) => compact === w || compact.startsWith(w))) return "call";

  return "review";
}
