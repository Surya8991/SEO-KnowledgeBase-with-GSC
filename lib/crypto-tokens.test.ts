import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken, isEncrypted } from "@/lib/crypto-tokens";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
});

describe("crypto-tokens (audit M2)", () => {
  describe("with a key configured", () => {
    beforeEach(() => {
      process.env.GSC_TOKEN_KEY = "test-key-do-not-use-in-prod";
    });

    it("round-trips a token through encrypt/decrypt", () => {
      const plain = "ya29.a0AfB_very-secret-refresh-token";
      const enc = encryptToken(plain)!;
      expect(isEncrypted(enc)).toBe(true);
      expect(enc).not.toContain(plain);
      expect(decryptToken(enc)).toBe(plain);
    });

    it("produces a different ciphertext each call (random IV)", () => {
      expect(encryptToken("same")).not.toBe(encryptToken("same"));
    });

    it("passes through null", () => {
      expect(encryptToken(null)).toBeNull();
      expect(decryptToken(null)).toBeNull();
    });

    it("treats a value without the envelope prefix as legacy plaintext", () => {
      expect(decryptToken("legacy-plaintext-token")).toBe("legacy-plaintext-token");
    });

    it("fails to decrypt a tampered ciphertext (GCM auth)", () => {
      const enc = encryptToken("secret")!;
      const tampered = enc.slice(0, -4) + "AAAA";
      expect(() => decryptToken(tampered)).toThrow();
    });
  });

  describe("with no key configured", () => {
    beforeEach(() => {
      delete process.env.GSC_TOKEN_KEY;
      delete process.env.AUTH_SECRET;
    });

    it("encryptToken is a passthrough (dev)", () => {
      expect(encryptToken("plain")).toBe("plain");
    });

    it("decryptToken throws if it meets an encrypted value with no key", () => {
      process.env.GSC_TOKEN_KEY = "k";
      const enc = encryptToken("x")!;
      delete process.env.GSC_TOKEN_KEY;
      expect(() => decryptToken(enc)).toThrow(/GSC_TOKEN_KEY nor AUTH_SECRET/i);
    });
  });
});
