import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLink, authed, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";
import { makeImage } from "./images";

let h: Harness;
let alice: TestUser;
let bob: TestUser;
let aliceLink: { id: string };
let bobLink: { id: string; title: string };

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
  alice = await h.createUser({ username: "alice", email: "alice@example.com" });
  bob = await h.createUser({ username: "bob", email: "bob@example.com" });
  aliceLink = await addLink(h, alice, { title: "Alice link" });
  bobLink = await addLink(h, bob, { title: "Bob link" });
});

async function bobRows() {
  return {
    user: await h.db.prepare("SELECT * FROM users WHERE id = ?1").bind(bob.id).first(),
    links: (await h.db.prepare("SELECT * FROM links WHERE user_id = ?1 ORDER BY position").bind(bob.id).all()).results,
  };
}

describe("user A tries to reach user B's data", () => {
  it("cannot edit B's link by id, and gets the same answer as for an id that does not exist", async () => {
    const before = await bobRows();
    const attack = await h.request(`/api/v1/links/${bobLink.id}`, json({ title: "pwned", target: "https://evil.example", enabled: false }, alice.cookie, "PATCH"));
    const missing = await h.request("/api/v1/links/does-not-exist-123", json({ title: "pwned" }, alice.cookie, "PATCH"));
    expect(attack.status).toBe(404);
    expect(await attack.text()).toBe(await missing.text());
    expect(await bobRows()).toEqual(before);
  });

  it("cannot delete B's link", async () => {
    const attack = await h.request(`/api/v1/links/${bobLink.id}`, authed(alice.cookie, "DELETE"));
    expect(attack.status).toBe(404);
    expect(await rowCount(h, "links", `id = '${bobLink.id}'`)).toBe(1);
  });

  it("cannot see B's links in her list", async () => {
    const response = await h.request("/api/v1/links", authed(alice.cookie));
    const { links } = (await response.json()) as { links: Array<{ id: string }> };
    expect(links.map((link) => link.id)).toEqual([aliceLink.id]);
    expect(JSON.stringify(links)).not.toContain(bobLink.id);
  });

  it("cannot reorder with B's ids, and B's order does not change", async () => {
    const before = await bobRows();
    const second = await addLink(h, alice, { title: "Second" });
    for (const ids of [[aliceLink.id, second.id, bobLink.id], [bobLink.id, second.id], [bobLink.id]]) {
      const response = await h.request("/api/v1/links/order", json({ ids }, alice.cookie, "PUT"));
      expect(response.status).toBe(400);
    }
    expect(await bobRows()).toEqual(before);
  });

  it("creates links under her own account even when the body names B as the owner", async () => {
    const response = await h.request(
      "/api/v1/links",
      json({ title: "Sneaky", target: "https://example.com", user_id: bob.id, userId: bob.id, owner: bob.id }, alice.cookie),
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const row = await h.db.prepare("SELECT user_id FROM links WHERE id = ?1").bind(id).first<{ user_id: string }>();
    expect(row?.user_id).toBe(alice.id);
    expect(await rowCount(h, "links", `user_id = '${bob.id}'`)).toBe(1);
  });

  it("cannot change B's profile by mass assignment on /me", async () => {
    const before = await bobRows();
    const response = await h.request(
      "/api/v1/me",
      json({ bio: "mine", id: bob.id, user_id: bob.id, email: "bob@evil.example", is_banned: true, username: "bob", avatar_key: "x", created_at: 1 }, alice.cookie, "PATCH"),
    );
    expect(response.status === 200 || response.status === 409).toBe(true);
    expect(await bobRows()).toEqual(before);
    const me = (await (await h.request("/api/v1/me", authed(alice.cookie))).json()) as { id: string; email: string; username: string; bio: string };
    expect(me).toMatchObject({ id: alice.id, email: "alice@example.com", username: "alice" });
    const aliceRow = await h.db.prepare("SELECT is_banned, avatar_key, created_at FROM users WHERE id = ?1").bind(alice.id).first();
    expect(aliceRow).toEqual({ is_banned: 0, avatar_key: null, created_at: h.clock.now });
  });

  it("cannot take B's username", async () => {
    const response = await h.request("/api/v1/me", json({ username: "bob" }, alice.cookie, "PATCH"));
    expect(response.status).toBe(409);
    expect(await rowCount(h, "users", "username = 'bob'")).toBe(1);
  });

  it("cannot overwrite B's avatar, and B's avatar is untouched", async () => {
    const form = new FormData();
    form.append("file", new File([await makeImage("png")], "b.png"));
    await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: bob.cookie }, body: form });
    const before = await h.db.prepare("SELECT key FROM avatars WHERE user_id = ?1").bind(bob.id).first();

    const mine = new FormData();
    mine.append("file", new File([await makeImage("jpeg")], "a.jpg"));
    mine.append("user_id", bob.id);
    await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: alice.cookie }, body: mine });
    expect(await h.db.prepare("SELECT key FROM avatars WHERE user_id = ?1").bind(bob.id).first()).toEqual(before);
    expect(await rowCount(h, "avatars", `user_id = '${alice.id}'`)).toBe(1);
  });

  it("sees only her own statistics", async () => {
    for (let index = 0; index < 5; index += 1) await h.request("/api/v1/track", json({ page: "bob", link: bobLink.id }));
    await h.request("/api/v1/track", json({ page: "bob" }));
    const response = await h.request("/api/v1/me/stats", authed(alice.cookie));
    const body = (await response.json()) as { totals: object; top_links: unknown[] };
    expect(body.totals).toEqual({ views: 0, clicks: 0 });
    expect(body.top_links).toEqual([]);
  });

  it("gets an export that holds only her own data", async () => {
    await h.request("/api/v1/track", json({ page: "bob", link: bobLink.id }));
    const response = await h.request("/api/v1/me/export", authed(alice.cookie));
    const text = await response.text();
    expect(text).toContain("alice@example.com");
    expect(text).toContain(aliceLink.id);
    for (const secret of ["bob@example.com", bob.id, bobLink.id, "Bob link"]) expect(text).not.toContain(secret);
  });

  it("deletes only her own account", async () => {
    const before = await bobRows();
    expect((await h.request("/api/v1/me", authed(alice.cookie, "DELETE"))).status).toBe(204);
    expect(await bobRows()).toEqual(before);
    expect((await h.request("/api/v1/me", authed(bob.cookie))).status).toBe(200);
  });

  it("cannot use B's session cookie value with a different cookie name or case", async () => {
    const value = bob.cookie.split("=")[1] ?? "";
    for (const cookie of [`lb_session=${value}`, `__host-lb_session=${value}`, `__Secure-lb_session=${value}`]) {
      expect((await h.request("/api/v1/me", authed(cookie))).status, cookie).toBe(401);
    }
  });
});

describe("every protected endpoint refuses visitors who are not signed in", () => {
  const endpoints: Array<[string, string]> = [
    ["POST", "/api/v1/auth/logout"],
    ["GET", "/api/v1/me"],
    ["PATCH", "/api/v1/me"],
    ["DELETE", "/api/v1/me"],
    ["POST", "/api/v1/me/avatar"],
    ["GET", "/api/v1/me/stats"],
    ["GET", "/api/v1/me/export"],
    ["GET", "/api/v1/links"],
    ["POST", "/api/v1/links"],
    ["PUT", "/api/v1/links/order"],
    ["PATCH", "/api/v1/links/abcdefgh1234"],
    ["DELETE", "/api/v1/links/abcdefgh1234"],
  ];

  it.each(endpoints)("%s %s returns 401 in the standard error shape", async (method, path) => {
    const response = await h.request(path, { method, headers: { "content-type": "application/json" }, body: method === "GET" || method === "DELETE" ? null : "{}" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Please sign in to continue." } });
  });
});
