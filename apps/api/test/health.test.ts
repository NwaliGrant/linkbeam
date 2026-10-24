import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

describe("GET /api/v1/health", () => {
  it("returns ok", async () => {
    const response = await h.request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "linkbeam-api" });
  });

  it("sends the security headers on every response", async () => {
    const response = await h.request("/api/v1/health");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("error shape", () => {
  it("uses the shared error shape for unknown routes", async () => {
    const response = await h.request("/api/v1/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "This address does not exist." } });
  });

  it("rejects non-JSON bodies with 415 in the same shape", async () => {
    const response = await h.request("/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "email=a@b.com",
    });
    expect(response.status).toBe(415);
    expect(Object.keys(((await response.json()) as { error: object }).error).sort()).toEqual(["code", "message"]);
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await h.request("/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalid_json");
  });

  it("rejects oversized bodies with 413", async () => {
    const response = await h.request("/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", padding: "x".repeat(20_000) }),
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
  });

  it("never leaks internals on an unexpected failure", async () => {
    const broken = await createHarness();
    try {
      await broken.db.prepare("DROP TABLE links").run();
      const user = await broken.createUser({ username: "boom" });
      const response = await broken.request("/api/v1/links", { headers: { cookie: user.cookie } });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe(JSON.stringify({ error: { code: "server_error", message: "Something went wrong. Please try again." } }));
      expect(text).not.toMatch(/links|SQL|sqlite|no such table/i);
    } finally {
      await broken.dispose();
    }
  });
});
