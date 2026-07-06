import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assertProdWritesAllowed, currentDbHost } from "@/lib/db/prod-guard";

const ORIG = { ...process.env };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe("currentDbHost", () => {
  it("extracts the host from DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://u:p@ep-cool-pooler.neon.tech/db?sslmode=require";
    expect(currentDbHost()).toBe("ep-cool-pooler.neon.tech");
  });
  it("returns null when DATABASE_URL is unset or unparseable", () => {
    delete process.env.DATABASE_URL;
    expect(currentDbHost()).toBeNull();
    process.env.DATABASE_URL = "not a url";
    expect(currentDbHost()).toBeNull();
  });
});

describe("assertProdWritesAllowed (audit H5)", () => {
  it("throws when DATABASE_URL host matches PROD_DATABASE_HOST and no override", () => {
    process.env.DATABASE_URL = "postgresql://u:p@prod.neon.tech/db";
    process.env.PROD_DATABASE_HOST = "prod.neon.tech";
    delete process.env.ALLOW_PROD_WRITES;
    expect(() => assertProdWritesAllowed("delete rows")).toThrow(/production database/i);
  });

  it("allows when ALLOW_PROD_WRITES=1 even against prod host", () => {
    process.env.DATABASE_URL = "postgresql://u:p@prod.neon.tech/db";
    process.env.PROD_DATABASE_HOST = "prod.neon.tech";
    process.env.ALLOW_PROD_WRITES = "1";
    expect(() => assertProdWritesAllowed("delete rows")).not.toThrow();
  });

  it("allows when host differs from prod host", () => {
    process.env.DATABASE_URL = "postgresql://u:p@dev-branch.neon.tech/db";
    process.env.PROD_DATABASE_HOST = "prod.neon.tech";
    expect(() => assertProdWritesAllowed("delete rows")).not.toThrow();
  });

  it("warns but allows when PROD_DATABASE_HOST is unset (guard inactive)", () => {
    process.env.DATABASE_URL = "postgresql://u:p@whatever.neon.tech/db";
    delete process.env.PROD_DATABASE_HOST;
    expect(() => assertProdWritesAllowed("delete rows")).not.toThrow();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
