import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { PAIRING_ALPHABET, PAIRING_PORT_COUNT, PAIRING_PORT_MIN, pairingPortFromCode, pairingSecretSpace, validateQueue } from "./protocol";

function pairingCode(port: number, secret: number): string {
  let value = (port - PAIRING_PORT_MIN) * pairingSecretSpace + secret;
  let chars = "";
  for (let i = 0; i < 8; i++) { chars = PAIRING_ALPHABET[value % PAIRING_ALPHABET.length] + chars; value = Math.floor(value / PAIRING_ALPHABET.length); }
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

describe("ParthSender pairing protocol", () => {
  it("encodes every dynamic port in the one-time pairing code", () => {
    for (const offset of [0, 1, 7381, PAIRING_PORT_COUNT - 1]) {
      const port = PAIRING_PORT_MIN + offset;
      const code = pairingCode(port, crypto.randomInt(pairingSecretSpace));
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}-[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{4}$/);
      expect(pairingPortFromCode(code)).toBe(port);
    }
  });

  it("rejects ambiguous or malformed pairing codes", () => {
    expect(pairingPortFromCode("OOOO-0000")).toBeNull();
    expect(pairingPortFromCode("AB-CDEFGH")).toBeNull();
    expect(pairingPortFromCode("ABCD-1EFG")).toBeNull();
  });

  it("validates recipient data without transforming final message text", () => {
    const messages = [{ id: "m1", name: "Rahul Sharma", phone: "+91 98765 43210", message: "Approved final text 🎂" }];
    expect(validateQueue(messages)).toEqual([{ id: "m1", name: "Rahul Sharma", phone: "+91 98765 43210", message: "Approved final text 🎂" }]);
    expect(() => validateQueue([{ ...messages[0], id: "" }])).toThrow();
    expect(() => validateQueue([messages[0], messages[0]])).toThrow();
    expect(() => validateQueue([{ ...messages[0], phone: "555" }])).toThrow();
  });
});
