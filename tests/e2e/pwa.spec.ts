import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Stage 7: the installable app, offline editing, and friendly error states. These run against the production build
// (what is really deployed) with the API replaced by a small in-memory fake, so "offline" and "server down" are exact.
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..", "..", "apps", "web");
const require = createRequire(join(webRoot, "package.json"));
const PORT = 4323;
const BASE = `http://127.0.0.1:${PORT}`;

let server: { stop: () => Promise<void> } | undefined;
test.beforeAll(async () => {
  const { preview } = (await import(require.resolve("astro"))) as { preview: (options: object) => Promise<{ stop: () => Promise<void> }> };
  server = await preview({ root: webRoot, logLevel: "warn", server: { port: PORT, host: "127.0.0.1" } });
});
test.afterAll(async () => {
  await server?.stop();
});

interface FakeApi {
  down: boolean;
  failWith: number | null;
  patches: Array<{ path: string; body: Record<string, unknown> }>;
  links: Array<Record<string, unknown>>;
  profile: Record<string, unknown>;
}

function newFake(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    down: false,
    failWith: null,
    patches: [],
    links: [
      { id: "l1", kind: "url", title: "My shop", target: "https://example.com/shop", message: null, position: 0, enabled: true, starts_at: null, ends_at: null },
      { id: "l2", kind: "whatsapp", title: "Chat with me", target: "2348012345678", message: null, position: 1, enabled: true, starts_at: null, ends_at: null },
    ],
    profile: { id: "u1", email: "ada@example.com", username: "ada", display_name: "Ada Obi", bio: "Designer", avatar_url: null, theme: "forest", accent: null, button_shape: "pill", font_pair: "friendly", bg_style: "solid", show_badge: true, created_at: 1 },
    ...overrides,
  };
}

async function installFake(context: BrowserContext, fake: FakeApi): Promise<void> {
  await context.route("**/api/v1/**", async (route) => {
    if (fake.down) return route.abort("internetdisconnected");
    if (fake.failWith) return route.fulfill({ status: fake.failWith, contentType: "application/json", body: '{"error":{"code":"server_error","message":"Something went wrong. Please try again."}}' });
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    const ok = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "GET" && path === "/me") return ok(fake.profile);
    if (method === "GET" && path === "/links") return ok({ links: fake.links });
    if (method === "GET" && path === "/me/stats") return ok({ days: 7, totals: { views: 0, clicks: 0 }, daily: [], top_links: [] });
    if (method === "PATCH" && path === "/me") {
      const body = request.postDataJSON() as Record<string, unknown>;
      fake.patches.push({ path, body });
      fake.profile = { ...fake.profile, ...body };
      return ok(fake.profile);
    }
    const match = /^\/links\/([^/]+)$/.exec(path);
    if (method === "PATCH" && match) {
      const body = request.postDataJSON() as Record<string, unknown>;
      fake.patches.push({ path, body });
      fake.links = fake.links.map((link) => (link.id === match[1] ? { ...link, ...body } : link));
      return ok(fake.links.find((link) => link.id === match[1]));
    }
    if (method === "POST" && path === "/auth/logout") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"not_found","message":"This address does not exist."}}' });
  });
}

const firstTitle = (page: Page) => page.locator(".link-summary strong").first();

async function editFirstTitle(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole("button", { name: `Edit ${from}` }).click();
  await page.getByLabel("Title").fill(to);
}

async function waitForSnapshot(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => localStorage.getItem("linkbeam-snapshot-v1") !== null)).toBe(true);
}

async function openControlled(page: Page): Promise<void> {
  await page.goto(`${BASE}/dashboard`);
  await expect(firstTitle(page)).toContainText("My shop");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // The first visit is not controlled yet; a reload is, and that is what a returning person sees.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await waitForSnapshot(page);
}

test.describe("installable app", () => {
  test("the manifest is valid and its icons exist", async ({ page, request }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":{"code":"unauthorized","message":"Please sign in to continue."}}' }));
    for (const path of ["/signin", "/dashboard", "/"]) {
      await page.goto(BASE + path);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
      await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
      await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
    }
    const response = await request.get(`${BASE}/manifest.webmanifest`);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toBe("Linkbeam");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.scope).toBe("/");
    const sizes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of manifest.icons as Array<{ src: string; type: string }>) {
      const file = await request.get(BASE + icon.src);
      expect(file.ok(), icon.src).toBe(true);
      expect(file.headers()["content-type"]).toContain(icon.type);
    }
  });

  test("the service worker saves the page shell and never saves personal data", async ({ page, context }) => {
    await installFake(context, newFake());
    await openControlled(page);
    // Use the page to call the API and the public pages, then look at everything the worker saved.
    await page.evaluate(async () => {
      await fetch("/api/v1/me").catch(() => undefined);
      await fetch("/u/ada").catch(() => undefined);
    });
    const saved = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
      return urls;
    });
    expect(saved).toContain("/dashboard");
    expect(saved).toContain("/offline.html");
    expect(saved.some((path) => path.startsWith("/_astro/"))).toBe(true);
    expect(saved.filter((path) => path.startsWith("/api/") || path.startsWith("/u/"))).toEqual([]);
  });
});

test.describe("working offline", () => {
  test("open offline, edit, keep the edit across a reload, and send it when the connection returns", async ({ page, context }) => {
    const fake = newFake();
    await installFake(context, fake);
    await openControlled(page);

    // The connection goes away.
    fake.down = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toContainText("You are offline");
    await expect(firstTitle(page)).toContainText("My shop");

    // Edit a link title and the bio while offline.
    await editFirstTitle(page, "My shop", "My new shop");
    await expect(page.getByText("Saved on this device")).toBeVisible();
    expect(fake.patches).toEqual([]);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("linkbeam-drafts-v1"))).toContain("My new shop");

    // The tab is closed and opened again, still offline: the edit is still there.
    await page.reload();
    await expect(firstTitle(page)).toContainText("My new shop");

    // The connection comes back: the edit is sent, the banner goes, and the stored draft is removed.
    fake.down = false;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => fake.patches.length).toBeGreaterThan(0);
    expect(fake.patches.find((patch) => patch.path === "/links/l1")?.body).toEqual({ title: "My new shop" });
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("linkbeam-drafts-v1"))).toBeNull();
    await expect(firstTitle(page)).toContainText("My new shop");
  });

  test("the offline screen passes the accessibility check at phone width", async ({ page, context }) => {
    const fake = newFake();
    await installFake(context, fake);
    await page.setViewportSize({ width: 360, height: 800 });
    await openControlled(page);
    fake.down = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("a page that was never opened shows the friendly offline page", async ({ page, context }) => {
    await installFake(context, newFake());
    await openControlled(page);
    await context.setOffline(true);
    await page.goto(`${BASE}/terms`);
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("signing out removes the copy and the drafts kept on this device", async ({ page, context }) => {
    await installFake(context, newFake());
    await openControlled(page);
    await editFirstTitle(page, "My shop", "Changed");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("linkbeam-snapshot-v1"))).not.toBeNull();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/signin$/);
    expect(await page.evaluate(() => [localStorage.getItem("linkbeam-snapshot-v1"), localStorage.getItem("linkbeam-drafts-v1")])).toEqual([null, null]);
  });

  test("drafts of another account are never applied", async ({ page, context }) => {
    await installFake(context, newFake());
    await page.addInitScript(() => {
      if (!localStorage.getItem("seeded")) {
        localStorage.setItem("seeded", "1");
        localStorage.setItem("linkbeam-drafts-v1", JSON.stringify({ userId: "someone-else", profile: { display_name: "Intruder" }, links: { l1: { title: "Intruder link" } } }));
      }
    });
    await page.goto(`${BASE}/dashboard`);
    await expect(firstTitle(page)).toContainText("My shop");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Display name")).toHaveValue("Ada Obi");
  });
});

test.describe("friendly errors", () => {
  test("the server is down on first open: a clear message and a working Try again", async ({ page, context }) => {
    const fake = newFake({ down: true });
    await installFake(context, fake);
    await page.goto(`${BASE}/dashboard`);
    await expect(page.getByRole("heading", { name: "We could not load your dashboard" })).toBeVisible();
    await expect(page.getByText("We could not reach the server")).toBeVisible();
    fake.down = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(firstTitle(page)).toContainText("My shop");
  });

  test("a server error shows plain words, never technical detail", async ({ page, context }) => {
    await installFake(context, newFake({ failWith: 500 }));
    await page.goto(`${BASE}/dashboard`);
    await expect(page.getByRole("alert")).toContainText("Something went wrong. Please try again.");
    await expect(page.locator("body")).not.toContainText(/stack|sql|undefined|exception/i);
  });

  test("a save that the server refuses keeps the edit and offers Try again", async ({ page, context }) => {
    const fake = newFake();
    await installFake(context, fake);
    await page.goto(`${BASE}/dashboard`);
    await expect(firstTitle(page)).toBeVisible();
    fake.failWith = 500;
    await editFirstTitle(page, "My shop", "Kept edit");
    await expect(page.getByText("Not saved.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Kept edit");
    fake.failWith = null;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => fake.patches.some((patch) => patch.body.title === "Kept edit")).toBe(true);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });

  test("an account with no links shows a welcome, not an empty box", async ({ page, context }) => {
    await installFake(context, newFake({ links: [] }));
    await page.goto(`${BASE}/dashboard`);
    await expect(page.getByRole("heading", { name: "No links yet" })).toBeVisible();
    await expect(page.getByText("Buy me a coffee page")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/payment/i);
    await expect(page.getByRole("button", { name: "Add your first link" })).toBeVisible();
  });

  test("the stats tab shows an error with Try again when stats cannot load", async ({ page, context }) => {
    const fake = newFake();
    await installFake(context, fake);
    await page.goto(`${BASE}/dashboard`);
    await expect(firstTitle(page)).toBeVisible();
    fake.failWith = 500;
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    fake.failWith = null;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("an unknown website address shows the 404 page with a way home", async ({ page }) => {
    const response = await page.goto(`${BASE}/no-such-page`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the Linkbeam home page" })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  });
});
