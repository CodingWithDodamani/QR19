import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminAuthConfigured,
  isAdminBearer,
  isAdminRequest,
} from "./psp-auth";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/psp/configure", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin auth (P0-2)", () => {
  it("rejects bearer when ADMIN_TOKEN is unset", () => {
    vi.stubEnv("ADMIN_TOKEN", "");
    expect(isAdminBearer(req({ authorization: "Bearer anything" }))).toBe(false);
    expect(adminAuthConfigured()).toBe(false);
  });

  it("accepts the exact bearer token (timing-safe)", () => {
    vi.stubEnv("ADMIN_TOKEN", "test-admin-token-0123456789abcdef");
    expect(
      isAdminBearer(req({ authorization: "Bearer test-admin-token-0123456789abcdef" }))
    ).toBe(true);
    expect(isAdminBearer(req({ authorization: "Bearer wrong-token" }))).toBe(false);
    expect(isAdminBearer(req({}))).toBe(false);
  });

  it("rejects near-miss tokens of equal length", () => {
    vi.stubEnv("ADMIN_TOKEN", "a".repeat(32));
    expect(isAdminBearer(req({ authorization: `Bearer ${"b".repeat(32)}` }))).toBe(false);
  });

  it("accepts bearer in production without a session cookie", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_TOKEN", "prod-admin-token-0123456789abcdef");
    expect(
      isAdminRequest(req({ authorization: "Bearer prod-admin-token-0123456789abcdef" }))
    ).toBe(true);
    // No session + no bearer → denied in production when token configured.
    expect(isAdminRequest(req({}))).toBe(false);
  });
});
