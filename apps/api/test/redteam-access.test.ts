import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLink, authed, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";

// Red team, checklist rows 1, 8, 11, 14 and 15 (access control, redirects, poisoning, business logic, privacy).
// Every test is an attack. "Pass" means the defence held.

let h: Harness;
let a: TestUser;
let b: TestUser;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
  a = await h.createUser({ username: "alice" });
  b = await h.createUser({ username: "bobby" });
});

const get = (path: string, as: TestUser) => h.request(path, authed(as.cookie));
const send = (method: string, path: string, body: unknown, as: TestUser) => h.request(path, json(body, as.cookie, method));

describe("row 1: access control across every endpoint", () => {
  it("user A gets 404 on every link endpoint using B's link id, in the same shape as a missing id", async () => {
    const link = await addLink(h, b);
    const missing = "doesnotexist1";
    for (const [method, body] of [["PATCH", { title: "Hacked" }], ["DELETE", undefined]] as const) {
      const init = (): RequestInit => ({ method, headers: { cookie: a.cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const real = await h.request(`/api/v1/links/${link.id}`, init());
      const fake = await h.request(`/api/v1/links/${missing}`, init());
      expect(real.status, method).toBe(404);
      expect(await real.text(), method).toBe(await fake.text());
    }
    const stored = await h.db.prepare("SELECT title FROM links WHERE id = ?1").bind(link.id).first<{ title: string }>();
    expect(stored?.title).toBe("Link");
  });

  it("ids in the URL path cannot be tricked with encodings, case changes or traversal", async () => {
    const link = await addLink(h, b);
    for (const id of [link.id.toUpperCase(), `${link.id}%00`, `${link.id}/`, `..%2F${link.id}`, `${link.id}%20`, `${link.id}'`, `%27%20OR%20%271%27=%271`]) {
      const response = await h.request(`/api/v1/links/${id}`, { method: "DELETE", headers: { cookie: a.cookie } });
      expect([400, 404], id).toContain(response.status);
    }
    expect(await rowCount(h, "links", `id = '${link.id}'`)).toBe(1);
  });

  it("mass assignment: extra fields on every write are ignored and never stored", async () => {
    const extras = { is_banned: 1, id: "hijacked-id-1", user_id: b.id, email: "evil@example.com", created_at: 1, username_changed_at: 0, avatar_key: "x", position: 99, role: "admin", enabled_override: true };
    const profile = await send("PATCH", "/api/v1/me", { display_name: "Alice", ...extras }, a);
    expect(profile.status).toBe(200);
    const row = await h.db.prepare("SELECT id, email, is_banned, created_at, avatar_key FROM users WHERE id = ?1").bind(a.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ id: a.id, email: a.email, is_banned: 0 });
    expect(row?.created_at).not.toBe(1);
    expect(row?.avatar_key).toBeNull();

    const created = await send("POST", "/api/v1/links", { title: "Mine", target: "https://example.com", ...extras }, a);
    expect(created.status).toBe(201);
    const link = (await created.json()) as { id: string; position: number };
    expect(link.id).not.toBe("hijacked-id-1");
    expect(link.position).toBe(0);
    expect(await rowCount(h, "links", `user_id = '${b.id}'`)).toBe(0);

    const patched = await send("PATCH", `/api/v1/links/${link.id}`, { title: "Renamed", ...extras }, a);
    expect(patched.status).toBe(200);
    expect(await rowCount(h, "links", `id = '${link.id}' AND user_id = '${a.id}' AND position = 0`)).toBe(1);
  });

  it("a banned user's session stops working and their page disappears", async () => {
    await addLink(h, b);
    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(b.id).run();
    expect((await get("/api/v1/me", b)).status).toBe(401);
    expect((await h.request("/u/bobby")).status).toBe(404);
    expect((await h.request("/api/v1/u/bobby")).status).toBe(404);
  });

  it("A cannot reorder using a mix of A's and B's ids, and nothing moves", async () => {
    const mine = await addLink(h, a);
    const theirs = await addLink(h, b);
    const response = await send("PUT", "/api/v1/links/order", { ids: [theirs.id, mine.id] }, a);
    expect(response.status).toBe(400);
    expect(await rowCount(h, "links", `id = '${theirs.id}' AND position = 0`)).toBe(1);
  });

  it("order with out-of-range, negative, repeated or oversized lists is refused", async () => {
    const one = await addLink(h, a);
    const two = await addLink(h, a);
    for (const ids of [[one.id], [one.id, one.id], [one.id, two.id, two.id], [], Array.from({ length: 500 }, () => one.id), [one.id, -1], [one.id, null]]) {
      const response = await send("PUT", "/api/v1/links/order", { ids }, a);
      expect(response.status, JSON.stringify(ids).slice(0, 60)).toBe(400);
    }
    const positions = (await h.db.prepare("SELECT id, position FROM links WHERE user_id = ?1 ORDER BY position").bind(a.id).all<{ id: string; position: number }>()).results;
    expect(positions.map((row) => row.id)).toEqual([one.id, two.id]);
    expect((await send("PUT", "/api/v1/links/order", { ids: [two.id, one.id], position: -5 }, a)).status).toBe(204);
  });

  it("A cannot read B's stats, export or avatar through any parameter", async () => {
    const link = await addLink(h, b);
    await h.request("/api/v1/track", json({ page: "bobby", link: link.id }));
    for (const path of ["/api/v1/me/stats?days=7&user_id=" + b.id, "/api/v1/me/stats?days=7&username=bobby", "/api/v1/me/export?user=" + b.id]) {
      const text = await (await get(path, a)).text();
      expect(text, path).not.toContain(b.id);
      expect(text, path).not.toContain(link.id);
      expect(text, path).not.toContain(b.email);
    }
  });
});

describe("row 8: open redirect and server-side requests", () => {
  const hostile = ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"];

  it("sign-in links ignore next, redirect, url and return parameters and always go to our own site", async () => {
    for (const value of hostile) {
      for (const name of ["next", "redirect", "redirect_uri", "url", "return", "returnTo", "continue"]) {
        const response = await h.request(`/api/v1/auth/callback?token=nope&${name}=${encodeURIComponent(value)}`, { redirect: "manual" });
        expect(response.status).toBe(302);
        const location = response.headers.get("location") ?? "";
        expect(location, `${name}=${value}`).toMatch(/^https:\/\/linkbeam\.test\//);
        expect(location).not.toContain("evil");
      }
    }
  });

  it("a forged Host or X-Forwarded-Host header cannot change where we redirect or what we put in emails", async () => {
    const response = await h.rawRequest("/api/v1/auth/callback?token=nope", { headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" }, redirect: "manual" });
    expect(response.headers.get("location")).toMatch(/^https:\/\/linkbeam\.test\//);
    await h.request("/api/v1/auth/magic-link", { method: "POST", headers: { "content-type": "application/json", host: "evil.example", "x-forwarded-host": "evil.example", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ email: "victim@example.com", turnstile_token: "ok" }) });
    for (const mail of h.mail) expect(mail.link).toMatch(/^https:\/\/linkbeam\.test\//);
  });

  it("the server never fetches an address a user supplies (no link, report or profile field triggers a request)", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return Promise.reject(new Error("blocked by test"));
    }) as typeof fetch;
    try {
      await send("POST", "/api/v1/links", { title: "x", target: "http://169.254.169.254/latest/meta-data/" }, a);
      await send("POST", "/api/v1/links", { kind: "map", title: "x", target: "http://localhost:8787/admin" }, a);
      await send("PATCH", "/api/v1/me", { display_name: "http://127.0.0.1/", bio: "http://[::1]/" }, a);
      await h.request("/api/v1/report", json({ page: "alice", reason: "http://10.0.0.1/", turnstile_token: "ok" }));
      await h.request("/u/alice");
      await h.request("/api/v1/u/alice");
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual([]);
  });
});

describe("row 11: analytics poisoning", () => {
  it("a click for B's link sent with A's page name is not counted for anyone", async () => {
    const theirs = await addLink(h, b);
    await addLink(h, a);
    expect((await h.request("/api/v1/track", json({ page: "alice", link: theirs.id }))).status).toBe(204);
    expect(await rowCount(h, "daily_stats")).toBe(0);
  });

  it("clicks for disabled links, unknown links and unknown pages are not counted", async () => {
    const link = await addLink(h, b);
    await send("PATCH", `/api/v1/links/${link.id}`, { enabled: false }, b);
    for (const body of [{ page: "bobby", link: link.id }, { page: "bobby", link: "nolink123456" }, { page: "nobody", link: link.id }, { page: "BOBBY'--" }]) {
      expect((await h.request("/api/v1/track", json(body))).status).toBe(204);
    }
    expect(await rowCount(h, "daily_stats")).toBe(0);
  });

  it("one address cannot send more than 120 beacons a minute, so a script cannot inflate a page cheaply", async () => {
    const headers = { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" };
    const statuses: number[] = [];
    for (let index = 0; index < 150; index++) statuses.push((await h.request("/api/v1/track", { method: "POST", headers, body: JSON.stringify({ page: "bobby" }) })).status);
    expect(statuses.filter((status) => status === 204)).toHaveLength(120);
    expect(statuses.filter((status) => status === 429)).toHaveLength(30);
    const views = await h.db.prepare("SELECT views FROM daily_stats WHERE link_id IS NULL").first<{ views: number }>();
    expect(views?.views).toBe(120);
  });

  it("tracking needs no session and gives no sign-in power: a forged cookie on /track changes nothing", async () => {
    const response = await h.request("/api/v1/track", { method: "POST", headers: { "content-type": "application/json", cookie: "__Host-lb_session=forged" }, body: JSON.stringify({ page: "bobby" }) });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("oversized, non-JSON and extra-field beacons are refused or ignored", async () => {
    expect((await h.request("/api/v1/track", { method: "POST", headers: { "content-type": "text/plain" }, body: "page=bobby" })).status).toBe(415);
    expect((await h.request("/api/v1/track", json({ page: "x".repeat(41) }))).status).toBe(400);
    expect((await h.request("/api/v1/track", json({ page: "bobby", views: 1_000_000, clicks: 99 }))).status).toBe(204);
    const views = await h.db.prepare("SELECT views, clicks FROM daily_stats").first<{ views: number; clicks: number }>();
    expect(views).toEqual({ views: 1, clicks: 0 });
  });
});

describe("row 14: business logic abuse", () => {
  it("reserved names and their look-alikes cannot be claimed", async () => {
    const victim = await h.createUser();
    const lookalikes = ["admin", "adm1n", "admln", "ad-min", "ad_min", "a-d-m-i-n", "4dmin", "l1nkbeam", "linkbeam-", "linkbearn", "supp0rt", "support_", "0fficial", "off1cial", "securlty", "sec-urity", "te4m", "r00t", "n0reply"];
    const taken: string[] = [];
    for (const name of lookalikes) {
      const response = await send("PATCH", "/api/v1/me", { username: name }, victim);
      if (response.status === 200) {
        taken.push(name);
        await h.db.prepare("UPDATE users SET username = NULL, username_changed_at = NULL WHERE id = ?1").bind(victim.id).run();
      }
    }
    expect(taken).toEqual([]);
  });

  it("ordinary names that merely contain a reserved word are still allowed", async () => {
    const person = await h.createUser();
    expect((await send("PATCH", "/api/v1/me", { username: "ada-designs" }, person)).status).toBe(200);
  });

  it("the 30-link cap holds, and a 31st is refused", async () => {
    for (let index = 0; index < 30; index++) await addLink(h, a, { target: `https://example.com/${index}` });
    expect((await send("POST", "/api/v1/links", { title: "31", target: "https://example.com" }, a)).status).toBe(409);
    expect(await rowCount(h, "links", `user_id = '${a.id}'`)).toBe(30);
  });

  it("changing a username twice inside 7 days is refused, so an account cannot cycle through names to impersonate", async () => {
    expect((await send("PATCH", "/api/v1/me", { username: "alice2" }, a)).status).toBe(200);
    expect((await send("PATCH", "/api/v1/me", { username: "alice3" }, a)).status).toBe(429);
    h.clock.now += 7 * 86_400 + 1;
    expect((await send("PATCH", "/api/v1/me", { username: "alice3" }, a)).status).toBe(200);
  });

  it("after a rename the old name does not keep serving the page, and cannot be grabbed to hijack its links", async () => {
    await addLink(h, a);
    await send("PATCH", "/api/v1/me", { username: "alice2" }, a);
    expect((await h.request("/u/alice")).status).toBe(404);
    expect((await h.request("/u/alice2")).status).toBe(200);
  });

  it("display names and titles cannot hide text direction tricks or invisible characters", async () => {
    const code = (...points: number[]): string => String.fromCodePoint(...points);
    const tricks = [`Ada${code(0x202e)}evil`, `Ada${code(0x2066)}x${code(0x2069)}`, `Ada${code(0x200b)}Obi`, `Ada${code(0)}Obi`, `Ada${code(7)}Obi`, `A${code(0xfeff)}da`, `Ada${code(0x2028)}Obi`, `Ada${code(0xad)}Obi`, `Ada${code(0x061c)}Obi`];
    for (const value of tricks) {
      expect((await send("PATCH", "/api/v1/me", { display_name: value }, a)).status, JSON.stringify(value)).toBe(400);
      expect((await send("PATCH", "/api/v1/me", { bio: value }, a)).status, JSON.stringify(value)).toBe(400);
      expect((await send("POST", "/api/v1/links", { title: value, target: "https://example.com" }, a)).status, JSON.stringify(value)).toBe(400);
    }
    // A normal accented name and an emoji are fine.
    expect((await send("PATCH", "/api/v1/me", { display_name: "Ọlá Adéwálé 🌍" }, a)).status).toBe(200);
  });
});

describe("row 15: privacy leaks", () => {
  it("the public JSON and HTML never contain the email, the user id, session data or timestamps", async () => {
    await send("PATCH", "/api/v1/me", { display_name: "Alice A", bio: "Hello" }, a);
    const link = await addLink(h, a, { starts_at: 1_700_000_000, ends_at: 2_000_000_000 });
    const json1 = await (await h.request("/api/v1/u/alice")).text();
    const html = await (await h.request("/u/alice")).text();
    for (const secret of [a.email, a.id, a.cookie.split("=")[1] ?? "", "created_at", "username_changed_at", "last_seen", "is_banned", "email", "1700000000", "2000000000", "ip_hash"]) {
      expect(json1, `json has ${secret}`).not.toContain(secret);
      expect(html, `html has ${secret}`).not.toContain(secret);
    }
    // The link id is public by design (it is how a click is counted) and is a random value, not a counter.
    expect(json1).toContain(link.id);
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("the public JSON has exactly the expected keys", async () => {
    const body = (await (await h.request("/api/v1/u/alice")).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["avatar_url", "accent", "bio", "bg_style", "button_shape", "display_name", "font_pair", "links", "show_badge", "theme", "username"].sort());
  });

  it("errors never reveal internals, SQL, file paths or stack traces", async () => {
    const paths = ["/api/v1/links/%00", "/api/v1/u/%C0%AE", "/api/v1/me/stats?days=abc", "/api/v1/avatar/%27", "/u/%E0%A4%A", "/api/v1/nothing"];
    for (const path of paths) {
      const response = await h.request(path, authed(a.cookie));
      const text = await response.text();
      for (const leak of ["SQLITE", "D1_ERROR", "at async", "node_modules", "/home/", ".ts:", "SELECT ", "stack"]) expect(text, `${path} leaks ${leak}`).not.toContain(leak);
    }
  });

  it("deleting an account removes every trace of the person, and the public surfaces go dark", async () => {
    const link = await addLink(h, a);
    await h.request("/api/v1/track", json({ page: "alice", link: link.id }));
    await h.request("/api/v1/track", json({ page: "alice" }));
    await h.request("/api/v1/report", json({ page: "alice", reason: "test", turnstile_token: "ok" }));
    const avatar = await h.db.prepare("INSERT INTO avatars (key, user_id, content_type, data, created_at) VALUES ('k1', ?1, 'image/png', x'89504e47', 1)").bind(a.id).run();
    expect(avatar.success).toBe(true);
    await h.db.prepare("UPDATE users SET avatar_key = 'k1' WHERE id = ?1").bind(a.id).run();
    expect((await h.request("/api/v1/me", { method: "DELETE", headers: { cookie: a.cookie } })).status).toBe(204);

    for (const table of ["links", "daily_stats", "reports", "avatars", "sessions"]) {
      expect(await rowCount(h, table, `user_id = '${a.id}'`), table).toBe(0);
    }
    expect(await rowCount(h, "users", `id = '${a.id}'`)).toBe(0);
    expect((await h.request("/u/alice")).status).toBe(404);
    expect((await h.request("/api/v1/u/alice")).status).toBe(404);
    expect((await h.request("/api/v1/avatar/k1")).status).toBe(404);
    expect((await h.request("/api/v1/me", authed(a.cookie))).status).toBe(401);
    // The only thing left is one security-log line with no user attached.
    const left = await h.db.prepare("SELECT user_id FROM audit_log WHERE action = 'delete'").all<{ user_id: string | null }>();
    expect(left.results.every((row) => row.user_id === null)).toBe(true);
    const text = JSON.stringify((await h.db.prepare("SELECT * FROM audit_log").all()).results);
    expect(text).not.toContain(a.email);
  });

  it("deleted accounts leave no email in sign-in tokens once they are used or expired", async () => {
    await h.db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at, used_at) VALUES ('hh', ?1, ?2, ?3)").bind(a.email, h.clock.now + 900, h.clock.now).run();
    await h.request("/api/v1/me", { method: "DELETE", headers: { cookie: a.cookie } });
    const left = await h.db.prepare("SELECT email FROM login_tokens WHERE email = ?1").bind(a.email).all();
    expect(left.results).toEqual([]);
  });
});
