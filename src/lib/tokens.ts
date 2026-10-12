import { createHash, randomBytes, randomInt } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// No characters that are easy to misread (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Short code to verify over WhatsApp, e.g. "LUKE-7KQ2XM". */
export function generateCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `LUKE-${code}`;
}

/** Finds a Luke code inside a message ("Hola Luke 👋 mi código es luke-7kq2xm"). */
export function findCode(text: string): string | null {
  const match = text.toUpperCase().match(/\bLUKE-([A-Z0-9]{6})\b/);
  return match ? `LUKE-${match[1]}` : null;
}
