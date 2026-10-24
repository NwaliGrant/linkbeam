import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OAuthClient, OAuthIdentity, Provider } from "../src/oauth";
import { cleanup } from "../src/cleanup";
import { SESSION_IDLE_SECONDS, SESSION_TTL_SECONDS } from "../src/sessions";
import { authed, createHarness, json, rowCount, START_TIME, type Harness } from "./helpers";

// A stand-in for Google and GitHub. It records what the API asked for and answers from a table.
const identities = new Map<string, OAuthIdentity | null>();
const startedWith: { state: string; verifier: string }[] = [];
const fakeOAuth: OAuthClient = {
  isConfigured: (provider: Provider) => provider !== "github" || identities.has("__github_on__"),
  authorizationUrl(provider, state, verifier) {
    startedWith.push({ state, verifier });
    return new URL(`https://idp.test/${provider}?state=${state}`);
  },
  async identify(_provider, code, verifier) {
    if (!startedWith.some((started) => started.verifier === verifier)) return null;
    return identities.get(code) ?? null;
  },
};

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ oauth: fakeOAuth });
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
  identities.clear();
  startedWith.length = 0;
});

const cookieOf = (response: Response): string | null => response.headers.get("set-cookie")?.split(";")[0] ?? null;

describe("CSRF (red-team checklist 7)", () => {
  const attacks: [string, RequestInit][] = [
    ["a different Origin", { headers: { origin: "https://evil.example" } }],
    ["Origin: null (sandboxed iframe or redirect)", { headers: { origin: "null" } }],
    ["an Origin that only starts the same", { headers: { origin: "https://linkbeam.test.evil.example" } }],
    ["a lookalike with the right host in the path", { headers: { origin: "https://evil.example/https://linkbeam.test" } }],
    ["http instead of https", { headers: { origin: "http://linkbeam.test" } }],
    ["Sec-Fetch-Site: cross-site", { headers: { origin: "https://linkbeam.test", "sec-fetch-site": "cross-site" } }],
    ["Sec-Fetch-Site: same-site (a sibling subdomain)", { headers: { origin: "https://linkbeam.test", "sec-fetch-site": "same-site" } }],
    ["no Origin and no browser proof", { headers: {} }],
  ];

  for (const [name, extra] of attacks) {
    it(`blocks every state-changing endpoint with ${name}`, async () => {
      const user = await h.createUser({ username: "victim" });
      const calls: [string, string, unknown][] = [
        ["PATCH", "/api/v1/me", { display_name: "pwned" }],
        ["DELETE", "/api/v1/me", undefined],
        ["POST", "/api/v1/links", { title: "x", target: "https://example.com" }],
        ["PUT", "/api/v1/links/order", { ids: [] }],
        ["POST", "/api/v1/auth/logout", undefined],
        ["POST", "/api/v1/auth/logout-all", undefined],
        ["POST", "/api/v1/auth/magic-link", { email: "a@example.com" }],
        ["POST", "/api/v1/report", { page: "victim", reason: "x" }],
        ["POST", "/api/v1/track", { page: "victim" }],
      ];
      for (const [method, path, body] of calls) {
        const headers: Record<string, string> = { cookie: user.cookie, ...(extra.headers as Record<string, string>) };
        if (body !== undefined) headers["content-type"] = "application/json";
        const response = await h.rawRequest(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe("csrf_blocked");
      }
      // Nothing changed.
      const me = await h.request("/api/v1/me", authed(user.cookie));
      expect(me.status).toBe(200);
      expect(((await me.json()) as { display_name: string }).display_name).not.toBe("pwned");
    });
  }

  it("blocks a cross-site HTML form (urlencoded, no JSON) before the body is read", async () => {
    const user = await h.createUser();
    const response = await h.rawRequest("/api/v1/me", {
      method: "DELETE",
      headers: { cookie: user.cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      body: "confirm=1",
    });
    expect(response.status).toBe(403);
    expect(await rowCount(h, "users")).toBe(1);
  });

  it("allows the site's own requests, and safe GET requests from anywhere", async () => {
    const user = await h.createUser();
    const own = await h.rawRequest("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: user.cookie, origin: "https://linkbeam.test", "sec-fetch-site": "same-origin" },
    });
    expect(own.status).toBe(204);
    // A Fetch Metadata "same-origin" proof is enough when a browser omits Origin.
    const user2 = await h.createUser();
    const noOrigin = await h.rawRequest("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: user2.cookie, "sec-fetch-site": "same-origin" },
    });
    expect(noOrigin.status).toBe(204);
    const get = await h.rawRequest("/api/v1/health", { headers: { origin: "https://evil.example" } });
    expect(get.status).toBe(200);
  });

  it("is enforced even for sign-out (logout CSRF) and blocked requests leave the session intact", async () => {
    const user = await h.createUser();
    const blocked = await h.rawRequest("/api/v1/auth/logout", { method: "POST", headers: { cookie: user.cookie, origin: "https://evil.example" } });
    expect(blocked.status).toBe(403);
    expect(await rowCount(h, "sessions")).toBe(1);
  });
});

describe("magic-link rate limits and bot check", () => {
  const send = (email: string, ip: string, extra: Record<string, unknown> = {}) =>
    h.request("/api/v1/auth/magic-link", { ...json({ email, ...extra }), headers: { "content-type": "application/json", "cf-connecting-ip": ip } });

  it("limits each IP to 5 requests an hour, then answers 429 with Retry-After", async () => {
    for (let i = 0; i < 5; i++) expect((await send(`u${i}@example.com`, "203.0.113.1")).status).toBe(202);
    const blocked = await send("u9@example.com", "203.0.113.1");
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another visitor is not affected.
    expect((await send("other@example.com", "203.0.113.2")).status).toBe(202);
    // The window ends.
    h.clock.now += 3601;
    expect((await send("u9@example.com", "203.0.113.1")).status).toBe(202);
  });

  it("limits one inbox to 3 emails an hour but still answers 202, so it reveals nothing", async () => {
    for (let i = 0; i < 6; i++) expect((await send("victim@example.com", `198.51.100.${i}`)).status).toBe(202);
    expect(h.mail.filter((m) => m.email === "victim@example.com")).toHaveLength(3);
    expect(await rowCount(h, "login_tokens")).toBe(3);
  });

  it("keeps limits when the 429 comes from parallel requests (no race past the limit)", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => send(`p${i}@example.com`, "203.0.113.9")));
    expect(results.filter((r) => r.status === 202)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(15);
  });

  it("refuses a failed bot check and does not create a token or send mail", async () => {
    const response = await send("a@example.com", "203.0.113.3", { turnstile_token: "bad-token" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("turnstile_failed");
    expect(await rowCount(h, "login_tokens")).toBe(0);
    expect(h.mail).toHaveLength(0);
  });
});

describe("Turnstile verifier", () => {
  it("fails closed when no secret is set outside local development", async () => {
    const { turnstileFor } = await import("../src/turnstile");
    const production = turnstileFor({ DB: h.db, APP_URL: "https://linkbeam.test" });
    expect(await production("anything", "1.2.3.4")).toBe(false);
    expect(await production(undefined, null)).toBe(false);
    const development = turnstileFor({ DB: h.db, APP_URL: "http://localhost:4321", MAIL_MODE: "console" });
    expect(await development(undefined, null)).toBe(true);
  });

  it("with a secret, refuses a missing token without calling Cloudflare", async () => {
    const { turnstileFor } = await import("../src/turnstile");
    const verify = turnstileFor({ DB: h.db, APP_URL: "https://linkbeam.test", TURNSTILE_SECRET: "s" });
    expect(await verify(undefined, null)).toBe(false);
    expect(await verify("x".repeat(3000), null)).toBe(false);
  });
});

describe("/report and /track limits", () => {
  it("limits /report per IP, and the bot check runs before anything is stored", async () => {
    const report = (token?: string) =>
      h.request("/api/v1/report", { ...json({ page: "nobody", reason: "spam", ...(token ? { turnstile_token: token } : {}) }), headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" } });
    expect((await report("bad-token")).status).toBe(400);
    for (let i = 0; i < 4; i++) expect((await report("ok")).status).toBe(202);
    expect((await report("ok")).status).toBe(429);
  });

  it("limits /track per IP in memory (best effort) and still returns 204 inside the limit", async () => {
    const limited = await createHarness({ limits: { track: { limit: 3, windowSeconds: 60 } } });
    try {
      const track = () =>
        limited.request("/api/v1/track", { ...json({ page: "nobody" }), headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.60" } });
      expect([(await track()).status, (await track()).status, (await track()).status]).toEqual([204, 204, 204]);
      expect((await track()).status).toBe(429);
    } finally {
      await limited.dispose();
    }
  });
});

describe("token abuse (red-team checklist 2)", () => {
  async function linkFor(email: string): Promise<string> {
    await h.request("/api/v1/auth/magic-link", json({ email }));
    return (h.mail.at(-1)?.link ?? "").replace("https://linkbeam.test", "");
  }

  it("rate limits brute-forcing of the callback and never signs anyone in", async () => {
    const guess = () =>
      h.request(`/api/v1/auth/callback?token=${"A".repeat(43)}`, { headers: { "cf-connecting-ip": "203.0.113.70" } });
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await guess()).status);
    expect(statuses.filter((s) => s === 302)).toHaveLength(30);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10);
    expect(await rowCount(h, "sessions")).toBe(0);
  });

  it("replaying a link after logout does not bring the session back", async () => {
    const path = await linkFor("replay@example.com");
    const first = await h.request(path);
    const cookie = cookieOf(first) ?? "";
    expect((await h.request("/api/v1/auth/logout", authed(cookie, "POST"))).status).toBe(204);
    const again = await h.request(path);
    expect(again.headers.get("location")).toContain("error=invalid_link");
    expect((await h.request("/api/v1/me", authed(cookie))).status).toBe(401);
  });

  it("rejects cookies with changed, truncated, doubled, empty and oversized values", async () => {
    const user = await h.createUser();
    const token = user.cookie.split("=")[1] ?? "";
    const variants = [
      // Always a different last character. (Using a fixed "A" made this test fail 1 time in 64, when the token already ended in A.)
      `__Host-lb_session=${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
      `__Host-lb_session=${token.slice(1)}`,
      `__Host-lb_session=${token}${token}`,
      "__Host-lb_session=",
      `__Host-lb_session=${"A".repeat(5000)}`,
      `lb_session=${token}`, // right value, wrong (unprefixed) name
      `__Host-lb_session=${token.toUpperCase()}`,
      `__Host-lb_session=${encodeURIComponent("' OR 1=1 --")}`,
    ];
    for (const cookie of variants) expect((await h.request("/api/v1/me", authed(cookie))).status, cookie.slice(0, 40)).toBe(401);
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(200);
  });

  it("ends a session that has been idle for 14 days, even inside its 30 days", async () => {
    const user = await h.createUser();
    h.clock.now = START_TIME + SESSION_IDLE_SECONDS - 10;
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(200);
    // That request counted as activity, so a second idle stretch is what matters.
    h.clock.now += SESSION_IDLE_SECONDS + 10;
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(401);
  });

  it("keeps an active session alive but never past the absolute 30 days", async () => {
    const user = await h.createUser();
    for (let day = 1; day <= 29; day += 7) {
      h.clock.now = START_TIME + day * 86_400;
      expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(200);
    }
    h.clock.now = START_TIME + SESSION_TTL_SECONDS + 1;
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(401);
  });

  it("does not write to D1 on every request (last_seen is refreshed at most hourly)", async () => {
    const user = await h.createUser();
    const read = async () => (await h.db.prepare("SELECT last_seen_at AS t FROM sessions").first<{ t: number }>())?.t;
    h.clock.now = START_TIME + 60;
    await h.request("/api/v1/me", authed(user.cookie));
    expect(await read()).toBe(START_TIME);
    h.clock.now = START_TIME + 3700;
    await h.request("/api/v1/me", authed(user.cookie));
    expect(await read()).toBe(START_TIME + 3700);
  });

  it("logout-all ends every session of the account and no one else's", async () => {
    const a = await h.createUser({ email: "a@example.com" });
    const b = await h.createUser({ email: "b@example.com" });
    const { createSession } = await import("../src/sessions");
    const second = `__Host-lb_session=${await createSession(h.db, a.id, START_TIME, "phone")}`;
    expect((await h.request("/api/v1/auth/logout-all", authed(a.cookie, "POST"))).status).toBe(204);
    expect((await h.request("/api/v1/me", authed(a.cookie))).status).toBe(401);
    expect((await h.request("/api/v1/me", authed(second))).status).toBe(401);
    expect((await h.request("/api/v1/me", authed(b.cookie))).status).toBe(200);
    expect((await h.request("/api/v1/auth/logout-all", { method: "POST" })).status).toBe(401);
  });
});

describe("user enumeration (red-team checklist 3)", () => {
  it("returns byte-identical magic-link responses for existing, new, banned and malformed-but-valid emails", async () => {
    await h.createUser({ email: "exists@example.com" });
    const banned = await h.createUser({ email: "banned@example.com" });
    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(banned.id).run();
    const bodies = new Set<string>();
    const shapes = new Set<string>();
    for (const [i, email] of ["exists@example.com", "new@example.com", "banned@example.com", "EXISTS@Example.COM"].entries()) {
      const response = await h.request("/api/v1/auth/magic-link", { ...json({ email }), headers: { "content-type": "application/json", "cf-connecting-ip": `203.0.113.${100 + i}` } });
      bodies.add(`${response.status} ${await response.text()}`);
      shapes.add([...response.headers.keys()].filter((k) => k !== "date").sort().join(","));
    }
    expect([...bodies]).toHaveLength(1);
    expect(shapes.size).toBe(1);
  });

  it("answers an over-limit email exactly like a normal one", async () => {
    const ask = () => h.request("/api/v1/auth/magic-link", { ...json({ email: "x@example.com" }), headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 200)}` } });
    const normal = await ask();
    const normalText = await normal.text();
    for (let i = 0; i < 3; i++) await ask();
    const limited = await ask();
    expect(limited.status).toBe(normal.status);
    expect(await limited.text()).toBe(normalText);
  });

  it("sends the same redirect for a bad link whether or not the account exists", async () => {
    await h.createUser({ email: "exists@example.com" });
    const a = await h.request(`/api/v1/auth/callback?token=${"B".repeat(43)}`);
    const b = await h.request(`/api/v1/auth/callback?token=${"C".repeat(43)}`);
    expect(a.status).toBe(b.status);
    expect(a.headers.get("location")).toBe(b.headers.get("location"));
  });

  it("does not reveal whether a username is taken to signed-out visitors", async () => {
    await h.createUser({ username: "taken" });
    const taken = await h.request("/api/v1/u/taken");
    const free = await h.request("/api/v1/u/notfree1");
    expect(taken.status).toBe(200); // a public page is public by design
    expect(free.status).toBe(404);
    // But the reserved, malformed and free cases are indistinguishable from each other.
    const reserved = await h.request("/api/v1/u/admin");
    const malformed = await h.request("/api/v1/u/a%20b");
    const expected = await free.text();
    expect(await reserved.text()).toBe(expected);
    expect(await malformed.text()).toBe(expected);
  });

  it("returns the same report answer for pages that exist and pages that do not", async () => {
    await h.createUser({ username: "real" });
    const post = (page: string, ip: string) =>
      h.request("/api/v1/report", { ...json({ page, reason: "spam" }), headers: { "content-type": "application/json", "cf-connecting-ip": ip } });
    const real = await post("real", "203.0.113.150");
    const fake = await post("fake1", "203.0.113.151");
    expect(real.status).toBe(fake.status);
    expect(await real.text()).toBe(await fake.text());
  });
});

describe("Google and GitHub sign-in", () => {
  async function start(provider: string): Promise<{ response: Response; cookie: string; state: string }> {
    const response = await h.request(`/api/v1/auth/${provider}/start`);
    const location = response.headers.get("location") ?? "";
    return { response, cookie: cookieOf(response) ?? "", state: new URL(location).searchParams.get("state") ?? "" };
  }

  it("signs a new person in with a verified email and creates the account once", async () => {
    identities.set("good-code", { email: "oauth@example.com" });
    const { response, cookie, state } = await start("google");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^https:\/\/idp\.test\/google\?state=/);
    expect(cookie.startsWith("__Host-lb_oauth=")).toBe(true);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);

    const done = await h.request(`/api/v1/auth/google/callback?code=good-code&state=${state}`, { headers: { cookie } });
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("https://linkbeam.test/dashboard");
    const session = (done.headers.getSetCookie().find((c) => c.startsWith("__Host-lb_session=")) ?? "").split(";")[0] ?? "";
    expect((await h.request("/api/v1/me", authed(session))).status).toBe(200);
    expect(await rowCount(h, "users", "email = 'oauth@example.com'")).toBe(1);
  });

  it("signs an existing magic-link user in to the same account", async () => {
    await h.createUser({ email: "same@example.com" });
    identities.set("c", { email: "same@example.com" });
    const { cookie, state } = await start("google");
    const done = await h.request(`/api/v1/auth/google/callback?code=c&state=${state}`, { headers: { cookie } });
    const session = (done.headers.getSetCookie().find((c) => c.startsWith("__Host-lb_session=")) ?? "").split(";")[0] ?? "";
    const me = (await (await h.request("/api/v1/me", authed(session))).json()) as { id?: string; email?: string };
    expect(me.email).toBe("same@example.com");
    expect(await rowCount(h, "users")).toBe(1);
  });

  it("is single-use: a replayed callback is rejected", async () => {
    identities.set("c", { email: "once@example.com" });
    const { cookie, state } = await start("google");
    const url = `/api/v1/auth/google/callback?code=c&state=${state}`;
    expect((await h.request(url, { headers: { cookie } })).headers.get("location")).toContain("/dashboard");
    expect((await h.request(url, { headers: { cookie } })).headers.get("location")).toContain("error=invalid_link");
  });

  it("refuses a callback with no state cookie (login CSRF), a different state, or someone else's state", async () => {
    identities.set("c", { email: "victim@example.com" });
    const attacker = await start("google");
    const victim = await start("google");
    const base = "/api/v1/auth/google/callback?code=c&state=";
    // The attacker sends the victim a link carrying the attacker's state; the victim's browser has its own cookie.
    expect((await h.request(base + attacker.state, { headers: { cookie: victim.cookie } })).headers.get("location")).toContain("invalid_link");
    // No cookie at all.
    expect((await h.request(base + victim.state)).headers.get("location")).toContain("invalid_link");
    // Invented state.
    expect((await h.request(base + "A".repeat(43), { headers: { cookie: `__Host-lb_oauth=${"A".repeat(43)}` } })).headers.get("location")).toContain("invalid_link");
    expect(await rowCount(h, "sessions")).toBe(0);
    expect(await rowCount(h, "users")).toBe(0);
  });

  it("refuses an expired state and a state started for the other provider", async () => {
    identities.set("c", { email: "late@example.com" });
    const expired = await start("google");
    h.clock.now += 601;
    expect((await h.request(`/api/v1/auth/google/callback?code=c&state=${expired.state}`, { headers: { cookie: expired.cookie } })).headers.get("location")).toContain("invalid_link");

    identities.set("__github_on__", { email: "x@example.com" });
    const google = await start("google");
    expect((await h.request(`/api/v1/auth/github/callback?code=c&state=${google.state}`, { headers: { cookie: google.cookie } })).headers.get("location")).toContain("invalid_link");
  });

  it("refuses when the provider does not confirm a verified email", async () => {
    const { cookie, state } = await start("google");
    const done = await h.request(`/api/v1/auth/google/callback?code=unknown-code&state=${state}`, { headers: { cookie } });
    expect(done.headers.get("location")).toContain("invalid_link");
    expect(await rowCount(h, "users")).toBe(0);
  });

  it("does not sign in a banned user", async () => {
    const user = await h.createUser({ email: "ban@example.com" });
    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(user.id).run();
    identities.set("c", { email: "ban@example.com" });
    const { cookie, state } = await start("google");
    const done = await h.request(`/api/v1/auth/google/callback?code=c&state=${state}`, { headers: { cookie } });
    expect(done.headers.get("location")).toContain("invalid_link");
  });

  it("sends visitors to a friendly error for unknown or unconfigured providers, never to a given URL", async () => {
    for (const provider of ["github", "facebook", "..%2Fadmin"]) {
      const response = await h.request(`/api/v1/auth/${provider}/start?next=https://evil.example`);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://linkbeam.test/signin?error=provider_unavailable");
    }
  });

  it("limits new accounts to 10 per IP a day", async () => {
    const ipHeaders = { "cf-connecting-ip": "203.0.113.200" };
    let created = 0;
    let blocked = 0;
    for (let i = 0; i < 12; i++) {
      identities.set(`c${i}`, { email: `bot${i}@example.com` });
      const begun = await h.request("/api/v1/auth/google/start", { headers: ipHeaders });
      const cookie = cookieOf(begun) ?? "";
      const state = new URL(begun.headers.get("location") ?? "https://x").searchParams.get("state") ?? "";
      const done = await h.request(`/api/v1/auth/google/callback?code=c${i}&state=${state}`, { headers: { ...ipHeaders, cookie } });
      const where = done.headers.get("location") ?? "";
      if (where.endsWith("/dashboard")) created++;
      if (where.includes("rate_limited")) blocked++;
    }
    expect(created).toBe(10);
    expect(blocked).toBe(2);
    expect(await rowCount(h, "users")).toBe(10);
  });
});

describe("cleanup job", () => {
  it("deletes only what can no longer be used", async () => {
    const live = await h.createUser();
    const stale = await h.createUser();
    await h.db.prepare("UPDATE sessions SET expires_at = ?1 WHERE user_id = ?2").bind(START_TIME - 1, stale.id).run();
    await h.db.batch([
      h.db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('old', 'a@b.co', ?1)").bind(START_TIME - 90_000),
      h.db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('recent', 'a@b.co', ?1)").bind(START_TIME - 60),
      h.db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('future', 'a@b.co', ?1)").bind(START_TIME + 60),
      h.db.prepare("INSERT INTO oauth_states (state_hash, provider, code_verifier, expires_at) VALUES ('s1', 'google', 'v', ?1)").bind(START_TIME - 1),
      h.db.prepare("INSERT INTO oauth_states (state_hash, provider, code_verifier, expires_at) VALUES ('s2', 'google', 'v', ?1)").bind(START_TIME + 100),
      h.db.prepare("INSERT INTO rate_limits (key, window, count, expires_at) VALUES ('k', 1, 1, ?1)").bind(START_TIME - 1),
      h.db.prepare("INSERT INTO rate_limits (key, window, count, expires_at) VALUES ('k2', 1, 1, ?1)").bind(START_TIME + 100),
      h.db.prepare("INSERT INTO audit_log (user_id, action, at) VALUES (NULL, 'old', ?1)").bind(START_TIME - 91 * 86_400),
      h.db.prepare("INSERT INTO audit_log (user_id, action, at) VALUES (NULL, 'recent', ?1)").bind(START_TIME - 89 * 86_400),
    ]);
    const result = await cleanup(h.db, START_TIME);
    expect(result).toEqual({ login_tokens: 1, oauth_states: 1, rate_limits: 1, sessions: 1, audit_log: 1 });
    expect(await rowCount(h, "audit_log", "action = 'recent'")).toBe(1);
    expect(await rowCount(h, "audit_log", "action = 'old'")).toBe(0);
    expect(await rowCount(h, "login_tokens")).toBe(2);
    expect((await h.request("/api/v1/me", authed(live.cookie))).status).toBe(200);
  });
});

describe("migration 0002 on an existing database", () => {
  it("upgrades sessions created before the migration without logging anyone out", async () => {
    const { Miniflare } = await import("miniflare");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-08-01", d1Databases: { DB: "upgrade" } });
    try {
      const db = (await mf.getD1Database("DB")) as unknown as D1Database;
      const run = async (file: string) => {
        const sql = readFileSync(join(__dirname, "..", "..", "..", "migrations", file), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
        for (const s of sql.split(/;\s*\n/)) if (s.trim()) await db.prepare(s).run();
      };
      await run("0001_init.sql");
      await db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.co', 1000)").run();
      await db.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES ('h', 'u1', 99999, 1000)").run();
      await run("0002_auth_hardening.sql");
      const row = await db.prepare("SELECT created_at, last_seen_at FROM sessions").first<{ created_at: number; last_seen_at: number }>();
      expect(row).toEqual({ created_at: 1000, last_seen_at: 1000 });
    } finally {
      await mf.dispose();
    }
  });
});
