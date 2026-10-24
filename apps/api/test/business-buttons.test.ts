import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addLink, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";

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
  user = await h.createUser({ username: "shop" });
});

const create = (body: unknown, as: TestUser = user) => h.request("/api/v1/links", json(body, as.cookie));
const patchLink = (id: string, body: unknown, as: TestUser = user) => h.request(`/api/v1/links/${id}`, json(body, as.cookie, "PATCH"));
const page = async (name = "shop") => (await h.request(`/u/${name}`)).text();

interface LinkOut {
  id: string;
  kind: string;
  target: string;
}

const coffeeUrl = "https://buymeacoffee.com/your-name";

describe("the optional Buy me a coffee link", () => {
  it("makes a coffee link and shows it on the public page with a cup icon", async () => {
    const response = await create({ kind: "coffee", title: "Buy me a coffee", target: coffeeUrl });
    expect(response.status).toBe(201);
    const made = (await response.json()) as LinkOut;
    expect(made).toMatchObject({ kind: "coffee", target: coffeeUrl });
    expect(made).not.toHaveProperty("bank");
    const body = await page();
    expect(body).toContain(`href="${coffeeUrl}" data-l="${made.id}" rel="noopener noreferrer nofollow ugc"`);
    expect(body).toContain('<path d="M10 2v2"/>');
  });

  it("is optional: a page works with no coffee link at all", async () => {
    await addLink(h, user, { target: "https://example.com" });
    expect((await h.request("/u/shop")).status).toBe(200);
  });

  it("refuses other sites, http and tricks", async () => {
    for (const target of ["http://buymeacoffee.com/x", "https://paystack.com/pay/shop", "https://buymeacoffee.com.evil.com/x", "https://buymeacoffee.com", "javascript:alert(1)", "ftp://x.com/pay"]) {
      expect((await create({ kind: "coffee", title: "Coffee", target })).status, target).toBe(400);
    }
    expect(await rowCount(h, "links")).toBe(0);
  });

  it("no longer accepts the old payment kind or bank details", async () => {
    expect((await create({ kind: "pay", title: "Pay me", target: "https://paystack.com/pay/shop" })).status).toBe(400);
    const made = (await (await create({ kind: "url", title: "Site", target: "https://example.com", bank: { account_number: "0123456789" } })).json()) as Record<string, unknown>;
    expect(made).not.toHaveProperty("bank");
    const stored = await h.db.prepare("SELECT * FROM links").first<Record<string, unknown>>();
    expect(Object.keys(stored ?? {})).not.toContain("details");
    expect(JSON.stringify(await page())).not.toContain("0123456789");
  });

  it("changes only to another Buy Me a Coffee address, and stays private to its owner", async () => {
    const other = await h.createUser({ username: "other" });
    const made = (await (await create({ kind: "coffee", title: "Coffee", target: coffeeUrl })).json()) as LinkOut;
    expect((await patchLink(made.id, { target: "https://buymeacoffee.com/second" })).status).toBe(200);
    expect((await patchLink(made.id, { target: "https://example.com/x" })).status).toBe(400);
    expect((await patchLink(made.id, { target: "https://buymeacoffee.com/hack" }, other)).status).toBe(404);
  });

  it("never lets the title become markup", async () => {
    const attack = `<img src=x onerror=alert(1)>"><script>alert(2)</script>`;
    await create({ kind: "coffee", title: attack.slice(0, 60), target: coffeeUrl });
    const body = await page();
    expect(body).not.toContain("<img src=x");
    expect(body.match(/<script/g)).toHaveLength(1);
  });

  it("skips a damaged coffee row instead of breaking the page", async () => {
    const link = await addLink(h, user, { title: "Fine link" });
    await h.db.prepare("INSERT INTO links (id, user_id, kind, title, target, position) VALUES ('damaged00000001', ?1, 'coffee', 'Broken', 'https://evil.example/x', 5)").bind(user.id).run();
    const response = await h.request("/u/shop");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(link.id);
    expect(body).not.toContain("Broken");
  });
});

describe("the other buttons through the API", () => {
  it("map: a plain address becomes a map search link", async () => {
    const response = await create({ kind: "map", title: "Visit us", target: "12 Herbert Macaulay Way, Yaba, Lagos" });
    expect(response.status).toBe(201);
    expect(((await response.json()) as LinkOut).target).toBe("https://www.google.com/maps/search/?api=1&query=12%20Herbert%20Macaulay%20Way%2C%20Yaba%2C%20Lagos");
    expect(await page()).toContain("https://www.google.com/maps/search/?api=1&amp;query=12%20Herbert%20Macaulay%20Way%2C%20Yaba%2C%20Lagos");
  });

  it("map, email and phone refuse tricks", async () => {
    for (const body of [
      { kind: "map", target: "javascript:alert(1)" },
      { kind: "map", target: "Lagos //evil.example" },
      { kind: "email", target: "a@b.co?cc=evil@x.com" },
      { kind: "email", target: "a@b.co&body=hi" },
      { kind: "call", target: "+234801234567; rm -rf" },
      { kind: "whatsapp", target: "https://wa.me/2348012345678" },
    ]) {
      expect((await create({ title: "x", ...body })).status, JSON.stringify(body)).toBe(400);
    }
    expect(await rowCount(h, "links")).toBe(0);
  });

  it("whatsapp keeps the first message and sends it on the page", async () => {
    await create({ kind: "whatsapp", title: "Chat", target: "00234 801 234 5678", message: "Hello, I saw your page" });
    expect(await page()).toContain('href="https://wa.me/2348012345678?text=Hello%2C%20I%20saw%20your%20page"');
  });
});

describe("migration 0004 on an existing database", () => {
  it("turns old payment links into web links and keeps every link and its statistics", async () => {
    const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-08-01", d1Databases: { DB: "upgrade4" } });
    try {
      const db = (await mf.getD1Database("DB")) as unknown as D1Database;
      const run = async (file: string) => {
        const sql = readFileSync(join(__dirname, "..", "..", "..", "migrations", file), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
        for (const statement of sql.split(/;\s*\n/)) if (statement.trim()) await db.prepare(statement).run();
      };
      for (const file of ["0001_init.sql", "0002_auth_hardening.sql", "0003_appearance.sql"]) await run(file);
      await db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.co', 1000)").run();
      await db.prepare("INSERT INTO links (id, user_id, kind, title, target, position) VALUES ('l1', 'u1', 'pay', 'Old pay link', 'https://paystack.com/pay/x', 0), ('l2', 'u1', 'map', 'Map', 'https://maps.app.goo.gl/x', 1)").run();
      await db.prepare("INSERT INTO daily_stats (day, user_id, link_id, views, clicks) VALUES (20000, 'u1', 'l1', 0, 7), (20000, 'u1', NULL, 12, 0)").run();
      await run("0004_coffee_kind.sql");
      const rows = (await db.prepare("SELECT id, kind, title, target FROM links ORDER BY position").all()).results;
      expect(rows).toEqual([
        { id: "l1", kind: "url", title: "Old pay link", target: "https://paystack.com/pay/x" },
        { id: "l2", kind: "map", title: "Map", target: "https://maps.app.goo.gl/x" },
      ]);
      const stats = (await db.prepare("SELECT link_id, views, clicks FROM daily_stats ORDER BY clicks").all()).results;
      expect(stats).toEqual([{ link_id: null, views: 12, clicks: 0 }, { link_id: "l1", views: 0, clicks: 7 }]);
      // The new rule allows "coffee" and refuses "pay".
      await db.prepare("INSERT INTO links (id, user_id, kind, title, target, position) VALUES ('l3', 'u1', 'coffee', 'Coffee', 'https://buymeacoffee.com/x', 2)").run();
      await expect(db.prepare("INSERT INTO links (id, user_id, kind, title, target, position) VALUES ('l4', 'u1', 'pay', 'No', 'https://x.com', 3)").run()).rejects.toThrow();
      // Deleting a link still removes its statistics, so the cascade rule survived the rebuild.
      await db.prepare("PRAGMA foreign_keys = ON").run();
      await db.prepare("DELETE FROM links WHERE id = 'l1'").run();
      expect((await db.prepare("SELECT COUNT(*) AS n FROM daily_stats WHERE link_id = 'l1'").first<{ n: number }>())?.n).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
});
