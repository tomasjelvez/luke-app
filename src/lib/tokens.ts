import { createHash, randomBytes, randomInt } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Sin caracteres que se confunden al leerlos (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código corto para verificar por WhatsApp, ej. "LUKE-7KQ2XM". */
export function generateCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `LUKE-${code}`;
}

/** Busca un código de Luke dentro de un mensaje ("Hola Luke 👋 mi código es luke-7kq2xm"). */
export function findCode(text: string): string | null {
  const match = text.toUpperCase().match(/\bLUKE-([A-Z0-9]{6})\b/);
  return match ? `LUKE-${match[1]}` : null;
}
