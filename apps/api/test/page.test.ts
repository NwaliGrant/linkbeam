import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { START_TIME, addLink, createHarness, json, type Harness, type TestUser } from "./helpers";
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

const get = (name = "grant", init?: RequestInit) => h.request(`/u/${name}`, init);
const html = async (name = "grant") => (await get(name)).text();
const patchMe = (body: Record<string, unknown>) => h.request("/api/v1/me", json(body, owner.cookie, "PATCH"));

describe("GET /u/:username (the public page)", () => {
  it("shows the name, bio and buttons as real links", async () => {
    await patchMe({ display_name: "Grant Chukwudi", bio: "Designer in Lagos" });
    await addLink(h, owner, { title: "My site", target: "https://example.com/work" });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("<h1>Grant Chukwudi</h1>");
    expect(body).toContain("Designer in Lagos");
    expect(body).toMatch(/<a class="b" href="https:\/\/example\.com\/work" data-l="[\w-]+" rel="noopener noreferrer nofollow ugc">/);
    expect(body).toContain("<span>My site</span>");
    expect(body).toContain('<html lang="en">');
  });

  it("never lets user text become markup", async () => {
    const attack = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;
    await patchMe({ display_name: attack, bio: attack });
    await addLink(h, owner, { title: attack });
    const body = await html();
    expect(body).not.toContain("<script>alert");
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The only script on the page is our own beacon.
    expect(body.match(/<script/g)).toHaveLength(1);
  });

  it("refuses a dangerous address even if one reached the database directly", async () => {
    const link = await addLink(h, owner, { title: "Safe" });
    await h.db.prepare("INSERT INTO links (id, user_id, kind, title, target, position) VALUES (?1, ?2, 'url', 'Bad', ?3, 99)")
      .bind("badlinkid000001", owner.id, "javascript:alert(1)").run();
    await h.db.prepare("INSERT INTO links (id, user_id, kind, title, target, position) VALUES (?1, ?2, 'url', 'Bad2', ?3, 100)")
      .bind("badlinkid000002", owner.id, "data:text/html,<script>alert(1)</script>").run();
    const body = await html();
    expect(body).toContain(link.id);
    expect(body).not.toMatch(/javascript:|data:text|Bad</);
  });

  it("builds WhatsApp, call and email buttons", async () => {
    await addLink(h, owner, { kind: "whatsapp", title: "Chat", target: "+2348012345678", message: "Hi & hello" });
    await addLink(h, owner, { kind: "call", title: "Call", target: "+2348012345678" });
    await addLink(h, owner, { kind: "email", title: "Write", target: "me@example.com" });
    const body = await html();
    expect(body).toContain('href="https://wa.me/2348012345678?text=Hi%20%26%20hello"');
    expect(body).toContain('href="tel:+2348012345678"');
    expect(body).toContain('href="mailto:me@example.com"');
    // Phone and email buttons are not marked as external web links.
    expect(body).not.toMatch(/href="tel:[^>]*rel=/);
  });

  it("hides disabled links and applies the schedule", async () => {
    const off = await addLink(h, owner, { title: "Off" });
    await h.request(`/api/v1/links/${off.id}`, json({ enabled: false }, owner.cookie, "PATCH"));
    await addLink(h, owner, { title: "Later", starts_at: START_TIME + 3600 });
    await addLink(h, owner, { title: "Expired", starts_at: START_TIME - 7200, ends_at: START_TIME - 3600 });
    await addLink(h, owner, { title: "Now", starts_at: START_TIME - 60, ends_at: START_TIME + 60 });
    const first = await html();
    expect(first).toContain("<span>Now</span>");
    expect(first).not.toMatch(/<span>(Off|Later|Expired)<\/span>/);
    h.clock.now = START_TIME + 3700;
    const later = await html();
    expect(later).toContain("<span>Later</span>");
    expect(later).not.toContain("<span>Now</span>");
  });

  it("shows a friendly message when there are no links", async () => {
    expect(await html()).toContain("No links yet.");
  });

  it("always has a report link, and the badge only when the owner wants it", async () => {
    expect(await html()).toContain('href="/report?page=grant"');
    expect(await html()).toContain("Made with Linkbeam");
    await patchMe({ show_badge: false });
    const body = await html();
    expect(body).toContain("Report this page");
    expect(body).not.toContain("Made with Linkbeam");
  });

  it("applies the chosen look", async () => {
    await patchMe({ theme: "lime", accent: "#ff5500", button_shape: "square", font_pair: "clean", bg_style: "pattern" });
    const body = await html();
    expect(body).toContain("--p-bg:#0E1A13");
    expect(body).toContain("--p-button:#FF5500");
    expect(body).toContain("--p-radius:4px");
    expect(body).toContain('content="dark"');
    expect(body).not.toContain("Plus Jakarta Sans");
    await patchMe({ font_pair: "friendly" });
    expect(await html()).toContain("Plus Jakarta Sans");
  });

  it("has what search and sharing need, and no private data", async () => {
    await patchMe({ display_name: "Grant", bio: "Designer" });
    const body = await html();
    expect(body).toContain('<link rel="canonical" href="https://linkbeam.test/u/grant">');
    expect(body).toContain('<meta property="og:title" content="Grant">');
    expect(body).toContain('<meta property="og:description" content="Designer">');
    expect(body).toContain('<meta property="og:url" content="https://linkbeam.test/u/grant">');
    expect(body).toContain('<meta property="og:image" content="https://linkbeam.test/og-default.png">');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain('<meta name="robots" content="index,follow">');
    expect(body).not.toContain("private-address@example.com");
    expect(body).not.toContain(owner.id);
  });

  it("uses the person's photo as the share image when there is one", async () => {
    const form = new FormData();
    form.append("file", new File([await makeImage("png")], "a.png"));
    const upload = await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: owner.cookie }, body: form });
    const { avatar_url } = (await upload.json()) as { avatar_url: string };
    const body = await html();
    expect(body).toContain(`<meta property="og:image" content="https://linkbeam.test${avatar_url}">`);
    expect(body).toContain('<meta name="twitter:card" content="summary">');
    expect(body).toContain(`<img class="av" src="${avatar_url}" width="96" height="96"`);
  });

  it("sends a Content-Security-Policy that allows only our own script", async () => {
    const response = await get();
    const body = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";
    const script = /<script>([\s\S]*?)<\/script>/.exec(body)?.[1] ?? "";
    const hash = createHash("sha256").update(script).digest("base64");
    expect(csp).toContain(`script-src 'sha256-${hash}'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("lets shared caches keep it for a minute, makes browsers check, and answers 304 when nothing changed", async () => {
    const first = await get();
    expect(first.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const again = await get("grant", { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    await patchMe({ display_name: "Changed" });
    const changed = await get("grant", { headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
  });

  it("redirects other letter cases to the one address", async () => {
    const response = await h.rawRequest("/u/GRANT", { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/u/grant");
  });

  it("shows a friendly 404 page for unknown, reserved and banned names", async () => {
    for (const name of ["nobody", "admin", "x", "bad%20name", "a".repeat(40)]) {
      const response = await get(name);
      expect(response.status, name).toBe(404);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(await response.text()).toContain("This page does not exist");
    }
    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(owner.id).run();
    expect((await get()).status).toBe(404);
  });

  it("stays small: a full page of 30 links is under 6 KB compressed", async () => {
    await patchMe({ display_name: "Grant Chukwudi", bio: "Designer in Lagos. I make things for people." });
    for (let index = 0; index < 30; index++) await addLink(h, owner, { title: `Link number ${index}`, target: `https://example.com/page/${index}` });
    const body = await html();
    expect(gzipSync(body).length).toBeLessThan(6000);
  });

  it("keeps the strict sandbox on photos", async () => {
    const form = new FormData();
    form.append("file", new File([await makeImage("png")], "a.png"));
    const upload = await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: owner.cookie }, body: form });
    const { avatar_url } = (await upload.json()) as { avatar_url: string };
    expect((await h.request(avatar_url)).headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("does not change the strict policy of the JSON API", async () => {
    const response = await h.request("/api/v1/health");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe("when the server fails while making a public page", () => {
  it("shows a friendly page with no technical detail, a strict policy, and nothing cached", async () => {
    await h.db.exec("ALTER TABLE links RENAME TO links_hidden");
    try {
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
      expect(response.headers.get("content-security-policy")).not.toMatch(/unsafe-inline/);
      const body = await response.text();
      expect(body).toContain("This page is not working right now");
      expect(body).toContain("Try again");
      expect(body).not.toMatch(/SQL|links_hidden|no such table|SqliteError|D1_/i);
      expect(body).not.toContain("<script");
    } finally {
      await h.db.exec("ALTER TABLE links_hidden RENAME TO links");
    }
  });

  it("still answers the API with JSON errors, not a web page", async () => {
    await h.db.exec("ALTER TABLE links RENAME TO links_hidden");
    try {
      const response = await h.request("/api/v1/links", { headers: { cookie: owner.cookie } });
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
    } finally {
      await h.db.exec("ALTER TABLE links_hidden RENAME TO links");
    }
  });
});
