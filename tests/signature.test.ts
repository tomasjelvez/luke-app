import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyKapsoSignature } from "../src/lib/signature.js";

const secret = "s3cret";
const body = '{"message":{"id":"wamid.1"}}';
const sign = (b: string) => createHmac("sha256", secret).update(b).digest("hex");

describe("verifyKapsoSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyKapsoSignature(body, sign(body), secret)).toBe(true);
  });

  it("rejects a missing, invalid or mismatched signature", () => {
    expect(verifyKapsoSignature(body, undefined, secret)).toBe(false);
    expect(verifyKapsoSignature(body, "abc", secret)).toBe(false);
    expect(verifyKapsoSignature(body, sign(body + " "), secret)).toBe(false);
    expect(verifyKapsoSignature(body, sign(body), "other")).toBe(false);
  });
});
