import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLink, authed, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";

let h: Harness;
let user: TestUser;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
  user = await h.createUser({ username: "shopowner" });
});

interface Link {
  id: string;
  kind: string;
  title: string;
  target: string;
  message: string | null;
  position: number;
  enabled: boolean;
  starts_at: number | null;
  ends_at: number | null;
}

const list = async (): Promise<Link[]> =>
  ((await (await h.request("/api/v1/links", authed(user.cookie))).json()) as { links: Link[] }).links;
const create = (body: unknown) => h.request("/api/v1/links", json(body, user.cookie));
const patchLink = (id: string, body: unknown) => h.request(`/api/v1/links/${id}`, json(body, user.cookie, "PATCH"));
const reorder = (ids: string[]) => h.request("/api/v1/links/order", json({ ids }, user.cookie, "PUT"));

describe("POST /links", () => {
  it("creates a plain link with defaults", async () => {
    const response = await create({ title: " My site ", target: "https://Example.com" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      kind: "url",
      title: "My site",
      target: "https://example.com/",
      message: null,
      position: 0,
      enabled: true,
      starts_at: null,
      ends_at: null,
    });
  });

  it("creates every kind and normalises each target", async () => {
    const cases = [
      { kind: "url", target: "https://example.com", expected: "https://example.com/" },
      { kind: "whatsapp", target: "+234 801 234 5678", expected: "+2348012345678", message: "Hello, I found you on Linkbeam" },
      { kind: "coffee", target: "https://buymeacoffee.com/shop", expected: "https://buymeacoffee.com/shop" },
      { kind: "call", target: "+2348012345678", expected: "+2348012345678" },
      { kind: "email", target: "Hello@Example.com", expected: "hello@example.com" },
      { kind: "map", target: "https://maps.google.com/?q=Lagos", expected: "https://maps.google.com/?q=Lagos" },
    ];
    for (const { kind, target, expected, message } of cases) {
      const response = await create({ kind, title: kind, target, ...(message ? { message } : {}) });
      expect(response.status, kind).toBe(201);
      expect(((await response.json()) as Link).target, kind).toBe(expected);
    }
    expect((await list()).map((link) => link.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each([
    ["url", "javascript:alert(1)"],
    ["url", "JaVaScRiPt:alert(1)"],
    ["url", "data:text/html,<script>alert(1)</script>"],
    ["url", "vbscript:msgbox(1)"],
    ["url", "file:///etc/passwd"],
    ["url", "java\tscript:alert(1)"],
    ["url", "java\nscript:alert(1)"],
    ["url", "https://example.com/\u0000"],
    ["url", `https://example.com/${"a".repeat(2100)}`],
    ["coffee", "javascript:alert(1)"],
    ["map", "data:text/html,x"],
    ["whatsapp", "https://example.com"],
    ["whatsapp", "08012345678"],
    ["call", "tel:+2348012345678"],
    ["email", "not-an-email"],
    ["email", "+2348012345678"],
  ])("rejects a %s link to %j and stores nothing", async (kind, target) => {
    const response = await create({ kind, title: "x", target });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalid_input");
    expect(await rowCount(h, "links")).toBe(0);
  });

  it("rejects bad titles, kinds, schedules and message lengths", async () => {
    const bad = [
      { title: "", target: "https://example.com" },
      { title: "   ", target: "https://example.com" },
      { title: "a".repeat(61), target: "https://example.com" },
      { title: "x", target: "https://example.com", kind: "sms" },
      { title: "x", target: "https://example.com", starts_at: 200, ends_at: 100 },
      { kind: "whatsapp", title: "x", target: "+2348012345678", message: "m".repeat(301) },
      { target: "https://example.com" },
    ];
    for (const body of bad) expect((await create(body)).status).toBe(400);
    expect(await rowCount(h, "links")).toBe(0);
  });

  it("allows 30 links and refuses the 31st", async () => {
    for (let index = 0; index < 30; index += 1) await addLink(h, user, { title: `L${index}` });
    const response = await create({ title: "one too many", target: "https://example.com" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("link_limit");
    expect(await rowCount(h, "links")).toBe(30);
  });

  it("holds the limit of 30 when 50 requests arrive at once", async () => {
    const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => create({ title: `P${index}`, target: "https://example.com" })));
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(30);
    expect(statuses.filter((status) => status === 409)).toHaveLength(20);
    expect(await rowCount(h, "links")).toBe(30);
    const positions = (await list()).map((link) => link.position);
    expect(positions).toEqual(Array.from({ length: 30 }, (_, index) => index));
  });

  it("requires a session", async () => {
    expect((await h.request("/api/v1/links", json({ title: "x", target: "https://example.com" }))).status).toBe(401);
    expect((await h.request("/api/v1/links")).status).toBe(401);
  });
});

describe("PATCH /links/:id", () => {
  it("updates, disables and schedules a link", async () => {
    const link = await addLink(h, user);
    const response = await patchLink(link.id, { title: "New", target: "https://other.example", enabled: false, starts_at: 100, ends_at: 200, message: "hi" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: "New", target: "https://other.example/", enabled: false, starts_at: 100, ends_at: 200, message: "hi" });
    const cleared = await patchLink(link.id, { starts_at: null, ends_at: null, message: null });
    expect(await cleared.json()).toMatchObject({ starts_at: null, ends_at: null, message: null });
  });

  it("checks the target against the link's own kind", async () => {
    const phone = await addLink(h, user, { kind: "call", target: "+2348012345678" });
    expect((await patchLink(phone.id, { target: "https://example.com" })).status).toBe(400);
    expect((await patchLink(phone.id, { target: "+14155550100" })).status).toBe(200);
    const web = await addLink(h, user);
    expect((await patchLink(web.id, { target: "javascript:alert(1)" })).status).toBe(400);
  });

  it("checks the schedule order against stored values too", async () => {
    const link = await addLink(h, user, { starts_at: 100, ends_at: 200 });
    expect((await patchLink(link.id, { ends_at: 50 })).status).toBe(400);
    expect((await patchLink(link.id, { starts_at: 300 })).status).toBe(400);
  });

  it("cannot change kind, owner, position or id", async () => {
    const link = await addLink(h, user);
    const other = await h.createUser();
    const response = await patchLink(link.id, { kind: "coffee", user_id: other.id, position: 9, id: "hijacked-id-1234" });
    expect(response.status).toBe(200);
    const row = await h.db.prepare("SELECT kind, user_id, position, id FROM links WHERE id = ?1").bind(link.id).first();
    expect(row).toEqual({ kind: "url", user_id: user.id, position: 0, id: link.id });
  });

  it("returns 404 for unknown ids and 400 for malformed ids", async () => {
    expect((await patchLink("does-not-exist-123", { title: "x" })).status).toBe(404);
    expect((await patchLink("bad id!", { title: "x" })).status).toBe(400);
  });
});

describe("DELETE /links/:id", () => {
  it("deletes once, then returns 404", async () => {
    const link = await addLink(h, user);
    expect((await h.request(`/api/v1/links/${link.id}`, authed(user.cookie, "DELETE"))).status).toBe(204);
    expect((await h.request(`/api/v1/links/${link.id}`, authed(user.cookie, "DELETE"))).status).toBe(404);
    expect(await rowCount(h, "links")).toBe(0);
  });

  it("removes the link's click statistics with it", async () => {
    const link = await addLink(h, user);
    await h.request("/api/v1/track", json({ page: "shopowner", link: link.id }));
    expect(await rowCount(h, "daily_stats")).toBe(1);
    await h.request(`/api/v1/links/${link.id}`, authed(user.cookie, "DELETE"));
    expect(await rowCount(h, "daily_stats")).toBe(0);
  });
});

describe("PUT /links/order", () => {
  it("reorders links, including a swap", async () => {
    const [a, b, c] = [await addLink(h, user, { title: "A" }), await addLink(h, user, { title: "B" }), await addLink(h, user, { title: "C" })];
    expect((await reorder([c.id, a.id, b.id])).status).toBe(204);
    expect((await list()).map((link) => link.title)).toEqual(["C", "A", "B"]);
    expect((await reorder([b.id, a.id, c.id])).status).toBe(204);
    expect((await list()).map((link) => [link.title, link.position])).toEqual([["B", 0], ["A", 1], ["C", 2]]);
  });

  it("works after deletions leave gaps, and with no links", async () => {
    expect((await reorder([])).status).toBe(204);
    const [a, b, c] = [await addLink(h, user, { title: "A" }), await addLink(h, user, { title: "B" }), await addLink(h, user, { title: "C" })];
    await h.request(`/api/v1/links/${b.id}`, authed(user.cookie, "DELETE"));
    expect((await reorder([c.id, a.id])).status).toBe(204);
    expect((await list()).map((link) => link.title)).toEqual(["C", "A"]);
    const next = await addLink(h, user, { title: "D" });
    expect(next.position).toBeGreaterThanOrEqual(2);
  });

  it("rejects missing, extra, duplicate, unknown and malformed ids and changes nothing", async () => {
    const [a, b] = [await addLink(h, user, { title: "A" }), await addLink(h, user, { title: "B" })];
    for (const ids of [[a.id], [a.id, b.id, "extra-id-123456"], [a.id, a.id], [a.id, "unknown-id-1234"], [a.id, "bad id!"], [],
    ]) {
      const response = await reorder(ids);
      expect(response.status, JSON.stringify(ids)).toBe(400);
    }
    expect((await list()).map((link) => link.title)).toEqual(["A", "B"]);
  });
});
