import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLink, authed, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";
import { makeImage } from "./images";

let h: Harness;
let owner: TestUser;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
  owner = await h.createUser({ username: "grant", email: "private-address@example.com" });
});

interface PublicPage {
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  theme: string;
  accent: string | null;
  links: Array<{ id: string; kind: string; title: string; target: string; message: string | null }>;
}

const page = (name = "grant") => h.request(`/api/v1/u/${name}`);
const track = (body: unknown) => h.request("/api/v1/track", json(body));

describe("GET /u/:username", () => {
  it("returns exactly the public fields and nothing private", async () => {
    await h.request("/api/v1/me", json({ display_name: "Grant", bio: "Designer" }, owner.cookie, "PATCH"));
    await addLink(h, owner, { title: "Site" });
    const response = await page();
    expect(response.status).toBe(200);
    const body = (await response.json()) as PublicPage;
    expect(Object.keys(body).sort()).toEqual(["accent", "avatar_url", "bg_style", "bio", "button_shape", "display_name", "font_pair", "links", "show_badge", "theme", "username"]);
    expect(Object.keys(body.links[0] ?? {}).sort()).toEqual(["id", "kind", "message", "target", "title"]);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain("private-address@example.com");
    expect(raw).not.toContain(owner.id);
    expect(raw).not.toMatch(/created_at|is_banned|user_id|position|enabled|starts_at|ends_at/);
  });

  it("is cacheable, unlike the rest of the API", async () => {
    expect((await page()).headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("finds pages in any letter case and returns 404 for unknown or reserved names", async () => {
    expect((await page("GRANT")).status).toBe(200);
    for (const name of ["nobody", "admin", "api", "x", "bad%20name", "a".repeat(40)]) {
      const response = await page(name);
      expect(response.status, name).toBe(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
    }
  });

  it("hides disabled links and links outside their schedule", async () => {
    const now = h.clock.now;
    await addLink(h, owner, { title: "visible" });
    await addLink(h, owner, { title: "disabled", enabled: false });
    await addLink(h, owner, { title: "future", starts_at: now + 100, ends_at: now + 200 });
    await addLink(h, owner, { title: "expired", starts_at: now - 200, ends_at: now - 100 });
    await addLink(h, owner, { title: "open-ended", starts_at: now - 100 });
    await addLink(h, owner, { title: "active-window", starts_at: now - 100, ends_at: now + 100 });

    const titles = async () => ((await (await page()).json()) as PublicPage).links.map((link) => link.title);
    expect(await titles()).toEqual(["visible", "open-ended", "active-window"]);

    h.clock.now = now + 150;
    expect(await titles()).toEqual(["visible", "future", "open-ended"]);
  });

  it("keeps link order and includes the avatar address", async () => {
    const a = await addLink(h, owner, { title: "A" });
    const b = await addLink(h, owner, { title: "B" });
    await h.request("/api/v1/links/order", json({ ids: [b.id, a.id] }, owner.cookie, "PUT"));
    const form = new FormData();
    form.append("file", new File([await makeImage("png")], "a.png"));
    await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: owner.cookie }, body: form });
    const body = (await (await page()).json()) as PublicPage;
    expect(body.links.map((link) => link.title)).toEqual(["B", "A"]);
    expect(body.avatar_url).toMatch(/^\/api\/v1\/avatar\//);
  });

  it("returns 404 for a banned user's page and photo, and 404 after deletion", async () => {
    const form = new FormData();
    form.append("file", new File([await makeImage("png")], "a.png"));
    const upload = await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: owner.cookie }, body: form });
    const { avatar_url } = (await upload.json()) as { avatar_url: string };
    expect((await h.request(avatar_url)).status).toBe(200);

    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(owner.id).run();
    expect((await page()).status).toBe(404);
    expect((await h.request(avatar_url)).status).toBe(404);
  });
});

describe("POST /track", () => {
  it("counts page views and link clicks and returns 204", async () => {
    const link = await addLink(h, owner);
    expect((await track({ page: "grant" })).status).toBe(204);
    expect((await track({ page: "grant" })).status).toBe(204);
    expect((await track({ page: "grant", link: link.id })).status).toBe(204);
    const rows = await h.db.prepare("SELECT link_id, views, clicks FROM daily_stats ORDER BY link_id").all();
    expect(rows.results).toEqual([
      { link_id: null, views: 2, clicks: 0 },
      { link_id: link.id, views: 0, clicks: 1 },
    ]);
  });

  it("stores counts only: no visitor identifiers anywhere", async () => {
    await track({ page: "grant" });
    const columns = await h.db.prepare("SELECT name FROM pragma_table_info('daily_stats')").all<{ name: string }>();
    expect(columns.results.map((column) => column.name).sort()).toEqual(["clicks", "day", "link_id", "user_id", "views"]);
    expect(await rowCount(h, "audit_log")).toBe(0);
  });

  it("counts exactly when 50 requests arrive together", async () => {
    const link = await addLink(h, owner);
    await Promise.all([
      ...Array.from({ length: 50 }, () => track({ page: "grant" })),
      ...Array.from({ length: 50 }, () => track({ page: "grant", link: link.id })),
    ]);
    const rows = await h.db.prepare("SELECT link_id, views, clicks FROM daily_stats ORDER BY views DESC").all();
    expect(rows.results).toEqual([
      { link_id: null, views: 50, clicks: 0 },
      { link_id: link.id, views: 0, clicks: 50 },
    ]);
  });

  it("starts a new row each day", async () => {
    await track({ page: "grant" });
    h.clock.now += 86_400;
    await track({ page: "grant" });
    expect(await rowCount(h, "daily_stats")).toBe(2);
  });

  it("silently ignores unknown pages, banned pages, other people's links and disabled links", async () => {
    const other = await h.createUser({ username: "other" });
    const foreign = await addLink(h, other);
    const disabled = await addLink(h, owner, { enabled: false });
    expect((await track({ page: "nobody" })).status).toBe(204);
    expect((await track({ page: "admin" })).status).toBe(204);
    expect((await track({ page: "grant", link: foreign.id })).status).toBe(204);
    expect((await track({ page: "grant", link: disabled.id })).status).toBe(204);
    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(other.id).run();
    expect((await track({ page: "other" })).status).toBe(204);
    expect(await rowCount(h, "daily_stats")).toBe(0);
  });

  it("rejects malformed bodies", async () => {
    for (const body of [{}, { page: 5 }, { page: "grant", link: "bad id!" }, { page: "x".repeat(41) }]) {
      expect((await track(body)).status).toBe(400);
    }
    expect(await rowCount(h, "daily_stats")).toBe(0);
  });
});

describe("GET /me/stats", () => {
  it("returns zero-filled daily numbers, totals and top links", async () => {
    const a = await addLink(h, owner, { title: "Alpha" });
    const b = await addLink(h, owner, { title: "Beta" });
    await track({ page: "grant" });
    await track({ page: "grant", link: a.id });
    await track({ page: "grant", link: b.id });
    await track({ page: "grant", link: b.id });
    h.clock.now += 3 * 86_400;
    await track({ page: "grant" });

    const response = await h.request("/api/v1/me/stats?days=7", authed(owner.cookie));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      days: number;
      totals: { views: number; clicks: number };
      daily: Array<{ date: string; views: number; clicks: number }>;
      top_links: Array<{ id: string; title: string; clicks: number }>;
    };
    expect(body.days).toBe(7);
    expect(body.daily).toHaveLength(7);
    expect(body.totals).toEqual({ views: 2, clicks: 3 });
    expect(body.daily.at(-1)?.date).toBe(new Date(h.clock.now * 1000).toISOString().slice(0, 10));
    expect(body.daily.filter((day) => day.views > 0 || day.clicks > 0)).toHaveLength(2);
    expect(body.top_links.map((link) => [link.title, link.clicks])).toEqual([["Beta", 2], ["Alpha", 1]]);
  });

  it("defaults to 7 days, supports 30, and rejects other windows", async () => {
    const seven = (await (await h.request("/api/v1/me/stats", authed(owner.cookie))).json()) as { daily: unknown[] };
    const thirty = (await (await h.request("/api/v1/me/stats?days=30", authed(owner.cookie))).json()) as { daily: unknown[] };
    expect(seven.daily).toHaveLength(7);
    expect(thirty.daily).toHaveLength(30);
    expect((await h.request("/api/v1/me/stats?days=9999", authed(owner.cookie))).status).toBe(400);
    expect((await h.request("/api/v1/me/stats?days=abc", authed(owner.cookie))).status).toBe(400);
  });

  it("gives a clear empty state for a new account", async () => {
    const response = await h.request("/api/v1/me/stats", authed(owner.cookie));
    const body = (await response.json()) as { totals: object; top_links: unknown[] };
    expect(body.totals).toEqual({ views: 0, clicks: 0 });
    expect(body.top_links).toEqual([]);
  });

  it("requires a session", async () => {
    expect((await h.request("/api/v1/me/stats")).status).toBe(401);
  });
});

describe("POST /report", () => {
  it("records a report", async () => {
    const response = await h.request("/api/v1/report", json({ page: "grant", reason: "Spam links" }));
    expect(response.status).toBe(202);
    const rows = await h.db.prepare("SELECT user_id, reason, status FROM reports").all();
    expect(rows.results).toEqual([{ user_id: owner.id, reason: "Spam links", status: "open" }]);
  });

  it("answers the same for pages that do not exist", async () => {
    const real = await h.request("/api/v1/report", json({ page: "grant", reason: "x" }));
    const fake = await h.request("/api/v1/report", json({ page: "nobody", reason: "x" }));
    expect(fake.status).toBe(real.status);
    expect(await fake.text()).toBe(await real.text());
    expect(await rowCount(h, "reports")).toBe(1);
  });

  it("rejects empty and over-long reasons", async () => {
    for (const reason of ["", "   ", "x".repeat(501)]) {
      expect((await h.request("/api/v1/report", json({ page: "grant", reason }))).status).toBe(400);
    }
    expect(await rowCount(h, "reports")).toBe(0);
  });
});
