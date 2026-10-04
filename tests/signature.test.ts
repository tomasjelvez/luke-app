import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyKapsoSignature } from "../src/lib/signature.js";

const secret = "s3cret";
const body = '{"message":{"id":"wamid.1"}}';
const sign = (b: string) => createHmac("sha256", secret).update(b).digest("hex");

describe("verifyKapsoSignature", () => {
  it("acepta una firma válida", () => {
    expect(verifyKapsoSignature(body, sign(body), secret)).toBe(true);
  });

  it("rechaza firma ausente, inválida o de otro cuerpo", () => {
    expect(verifyKapsoSignature(body, undefined, secret)).toBe(false);
    expect(verifyKapsoSignature(body, "abc", secret)).toBe(false);
    expect(verifyKapsoSignature(body, sign(body + " "), secret)).toBe(false);
    expect(verifyKapsoSignature(body, sign(body), "otro")).toBe(false);
  });
});
