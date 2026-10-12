import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies the HMAC-SHA256 (hex) signature Kapso sends in `X-Webhook-Signature`. */
export function verifyKapsoSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature.trim().replace(/^sha256=/, ""), "hex");
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}
