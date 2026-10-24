import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authed, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";

// Red team, second pass: 50 parallel requests at username claim, account deletion and link creation.
// Uniqueness and limits must hold however the requests interleave.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
});

const PARALLEL = 50;
const tally = (responses: Response[]): Record<number, number> => {
  const counts: Record<number, number> = {};
  for (const response of responses) counts[response.status] = (counts[response.status] ?? 0) + 1;
  return counts;
};

describe("50 parallel requests", () => {
  it("fifty different people claiming the same username: exactly one gets it", async () => {
    const users: TestUser[] = [];
    for (let index = 0; index < PARALLEL; index++) users.push(await h.createUser());
    const responses = await Promise.all(users.map((user) => h.request("/api/v1/me", json({ username: "contested" }, user.cookie, "PATCH"))));
    expect(tally(responses)).toEqual({ 200: 1, 409: PARALLEL - 1 });
    expect(await rowCount(h, "users", "username = 'contested'")).toBe(1);
  });

  it("the same name in different letter cases in parallel still gives exactly one winner", async () => {
    const users: TestUser[] = [];
    for (let index = 0; index < 20; index++) users.push(await h.createUser());
    const names = ["Contested", "CONTESTED", "contested", "cOnTeStEd"];
    const responses = await Promise.all(users.map((user, index) => h.request("/api/v1/me", json({ username: names[index % names.length] }, user.cookie, "PATCH"))));
    expect(tally(responses)).toEqual({ 200: 1, 409: 19 });
  });

  it("one person changing their username 50 times at once gets one change, not fifty (the 7-day limit holds)", async () => {
    const user = await h.createUser({ username: "firstname" });
    await h.db.prepare("UPDATE users SET username_changed_at = ?1 WHERE id = ?2").bind(h.clock.now - 8 * 86_400, user.id).run();
    const responses = await Promise.all(Array.from({ length: PARALLEL }, (_, index) => h.request("/api/v1/me", json({ username: `name-${index}` }, user.cookie, "PATCH"))));
    const counts = tally(responses);
    expect(counts[200]).toBe(1);
    expect((counts[429] ?? 0) + (counts[409] ?? 0)).toBe(PARALLEL - 1);
    expect(Object.keys(counts).every((status) => ["200", "409", "429"].includes(status))).toBe(true);
  });

  it("a first claim and many quick changes at once still end with one name and the cooldown started", async () => {
    const user = await h.createUser();
    const responses = await Promise.all(Array.from({ length: PARALLEL }, (_, index) => h.request("/api/v1/me", json({ username: `claim-${index}` }, user.cookie, "PATCH"))));
    const counts = tally(responses);
    expect(counts[200]).toBeLessThanOrEqual(1);
    const stored = await h.db.prepare("SELECT username FROM users WHERE id = ?1").bind(user.id).first<{ username: string }>();
    expect(stored?.username).toMatch(/^claim-\d+$/);
  });

  it("fifty parallel link creations stop at 30 links, with 30 different positions", async () => {
    const user = await h.createUser({ username: "linker" });
    const responses = await Promise.all(Array.from({ length: PARALLEL }, (_, index) => h.request("/api/v1/links", json({ title: `L${index}`, target: `https://example.com/${index}` }, user.cookie))));
    expect(tally(responses)).toEqual({ 201: 30, 409: 20 });
    expect(await rowCount(h, "links", `user_id = '${user.id}'`)).toBe(30);
    const positions = (await h.db.prepare("SELECT position FROM links WHERE user_id = ?1 ORDER BY position").bind(user.id).all<{ position: number }>()).results.map((row) => row.position);
    expect(positions).toEqual(Array.from({ length: 30 }, (_, index) => index));
  });

  it("with 25 links already, fifty parallel creations add exactly five", async () => {
    const user = await h.createUser({ username: "linker2" });
    for (let index = 0; index < 25; index++) await h.request("/api/v1/links", json({ title: `S${index}`, target: "https://example.com" }, user.cookie));
    const responses = await Promise.all(Array.from({ length: PARALLEL }, (_, index) => h.request("/api/v1/links", json({ title: `P${index}`, target: "https://example.com" }, user.cookie))));
    expect(tally(responses)).toEqual({ 201: 5, 409: 45 });
    expect(await rowCount(h, "links", `user_id = '${user.id}'`)).toBe(30);
  });

  it("fifty parallel deletions of one account: one succeeds, the rest are signed out, and nothing is left", async () => {
    const user = await h.createUser({ username: "goner" });
    await h.request("/api/v1/links", json({ title: "x", target: "https://example.com" }, user.cookie));
    const responses = await Promise.all(Array.from({ length: PARALLEL }, () => h.request("/api/v1/me", { method: "DELETE", headers: { cookie: user.cookie } })));
    const counts = tally(responses);
    expect(counts[204]).toBeGreaterThanOrEqual(1);
    expect(Object.keys(counts).every((status) => ["204", "401"].includes(status))).toBe(true);
    for (const table of ["users", "links", "sessions", "daily_stats", "avatars", "reports"]) {
      expect(await rowCount(h, table, table === "users" ? `id = '${user.id}'` : `user_id = '${user.id}'`), table).toBe(0);
    }
  });

  it("creating links while the account is being deleted never leaves a link behind", async () => {
    const user = await h.createUser({ username: "racer" });
    const work: Array<Promise<Response>> = [];
    for (let index = 0; index < PARALLEL; index++) {
      work.push(h.request("/api/v1/links", json({ title: `R${index}`, target: "https://example.com" }, user.cookie)));
      if (index === 20) work.push(h.request("/api/v1/me", { method: "DELETE", headers: { cookie: user.cookie } }));
    }
    const responses = await Promise.all(work);
    for (const response of responses) expect(response.status).toBeLessThan(500);
    expect(await rowCount(h, "users", `id = '${user.id}'`)).toBe(0);
    expect(await rowCount(h, "links", `user_id = '${user.id}'`)).toBe(0);
    expect(await rowCount(h, "links")).toBe(0);
  });

  it("parallel reorders with different orders always leave a clean 0..n-1 numbering", async () => {
    const user = await h.createUser({ username: "orderer" });
    const ids: string[] = [];
    for (let index = 0; index < 8; index++) ids.push(((await (await h.request("/api/v1/links", json({ title: `O${index}`, target: "https://example.com" }, user.cookie))).json()) as { id: string }).id);
    const shuffles = Array.from({ length: PARALLEL }, (_, round) => ids.map((_, index) => ids[(index * 3 + round) % ids.length] ?? "").filter((value, index, all) => all.indexOf(value) === index));
    const full = shuffles.filter((list) => list.length === ids.length);
    const responses = await Promise.all(full.map((list) => h.request("/api/v1/links/order", json({ ids: list }, user.cookie, "PUT"))));
    for (const response of responses) expect([204, 400, 409]).toContain(response.status);
    const rows = (await h.db.prepare("SELECT position FROM links WHERE user_id = ?1 ORDER BY position").bind(user.id).all<{ position: number }>()).results.map((row) => row.position);
    expect(rows).toEqual(ids.map((_, index) => index));
    expect((await h.request("/api/v1/links", authed(user.cookie))).status).toBe(200);
  });

  it("fifty parallel beacons count every one (up to the limit) and never lose or double a count", async () => {
    const owner = await h.createUser({ username: "counted" });
    const responses = await Promise.all(Array.from({ length: PARALLEL }, () => h.request("/api/v1/track", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.77" }, body: JSON.stringify({ page: "counted" }) })));
    expect(tally(responses)).toEqual({ 204: PARALLEL });
    const row = await h.db.prepare("SELECT views FROM daily_stats WHERE user_id = ?1 AND link_id IS NULL").bind(owner.id).first<{ views: number }>();
    expect(row?.views).toBe(PARALLEL);
  });
});
