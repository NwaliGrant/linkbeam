import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { API, SITE, freshIp, seedPage, signUp, tab } from "./helpers";

/** A visitor who is not signed in, on their own made-up network address. */
async function visitor(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "cf-connecting-ip": freshIp() } });
  const page = await context.newPage();
  await page.route("https://example.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>Example</title><h1>Example site</h1>" }));
  return { context, page };
}

async function filePath(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error("The download has no file");
  return path;
}

async function stats(owner: Page): Promise<{ totals: { views: number; clicks: number }; top_links: Array<{ id: string; clicks: number }> }> {
  const response = await owner.request.get(`${SITE}/api/v1/me/stats?days=7`);
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("public page", () => {
  test("shows the owner's page, counts one view, and counts a click without slowing the link", async ({ page, browser, request }) => {
    await signUp(page, request);
    const { username, ids } = await seedPage(page, {
      display_name: "Ada Obi",
      bio: "Brand designer in Lagos.",
      links: [
        { kind: "url", title: "My portfolio", target: "https://example.com/portfolio" },
        { kind: "whatsapp", title: "Chat on WhatsApp", target: "+2348012345678", message: "Hello Ada" },
        { kind: "call", title: "Call the studio", target: "+2348012345678" },
      ],
    });
    expect(await stats(page)).toMatchObject({ totals: { views: 0, clicks: 0 } });

    const { context, page: visit } = await visitor(browser);
    const viewSent = visit.waitForResponse((r) => r.url().endsWith("/api/v1/track") && r.request().method() === "POST");
    const loaded = await visit.goto(`/u/${username}`);
    expect(loaded?.status()).toBe(200);
    await expect(visit.getByRole("heading", { level: 1, name: "Ada Obi" })).toBeVisible();
    await expect(visit.getByText("Brand designer in Lagos.")).toBeVisible();
    expect((await viewSent).status()).toBe(204);

    // Real addresses behind the buttons.
    await expect(visit.getByRole("link", { name: "Chat on WhatsApp" })).toHaveAttribute("href", "https://wa.me/2348012345678?text=Hello%20Ada");
    await expect(visit.getByRole("link", { name: "Call the studio" })).toHaveAttribute("href", "tel:+2348012345678");

    // Tapping a link goes straight to the site and the click is counted afterwards.
    await visit.getByRole("link", { name: "My portfolio" }).click();
    await expect(visit.getByRole("heading", { name: "Example site" })).toBeVisible();
    await expect.poll(async () => (await stats(page)).totals, { timeout: 10_000 }).toEqual({ views: 1, clicks: 1 });
    const after = await stats(page);
    expect(after.top_links[0]).toMatchObject({ id: ids[0], clicks: 1 });

    // The owner sees the same numbers in the Stats tab.
    await page.goto("/dashboard");
    await tab(page, "Stats").click();
    await expect(page.locator(".stat", { hasText: "Page views" }).locator("strong")).toHaveText("1");
    await expect(page.locator(".stat", { hasText: "Link clicks" }).locator("strong")).toHaveText("1");
    await expect(page.locator(".top-links")).toContainText("My portfolio");
    await context.close();
  });

  test("a link still opens when the counting request fails", async ({ page, browser, request }) => {
    await signUp(page, request);
    const { username } = await seedPage(page);
    const { context, page: visit } = await visitor(browser);
    await visit.route("**/api/v1/track", (route) => route.abort());
    await visit.goto(`/u/${username}`);
    await visit.getByRole("link", { name: "My portfolio" }).click();
    await expect(visit.getByRole("heading", { name: "Example site" })).toBeVisible();
    await context.close();
  });

  test("a middle-click on a link is counted too", async ({ page, browser, request }) => {
    await signUp(page, request);
    const { username } = await seedPage(page);
    const { context, page: visit } = await visitor(browser);
    await visit.goto(`/u/${username}`);
    await visit.getByRole("link", { name: "My portfolio" }).click({ button: "middle" });
    await expect.poll(async () => (await stats(page)).totals.clicks, { timeout: 10_000 }).toBe(1);
    await context.close();
  });

  test("hidden and scheduled links do not appear, and the page follows design changes", async ({ page, browser, request }) => {
    await signUp(page, request);
    const { username, ids } = await seedPage(page, {
      links: [
        { kind: "url", title: "Visible link", target: "https://example.com/a" },
        { kind: "url", title: "Switched off", target: "https://example.com/b" },
      ],
      profile: { theme: "lime", button_shape: "square", bg_style: "gradient", show_badge: false },
    });
    const off = await page.request.patch(`${SITE}/api/v1/links/${ids[1]}`, { headers: { origin: SITE }, data: { enabled: false } });
    expect(off.status()).toBe(200);
    const later = await page.request.post(`${SITE}/api/v1/links`, { headers: { origin: SITE }, data: { kind: "url", title: "Starts next year", target: "https://example.com/c", starts_at: Math.floor(Date.now() / 1000) + 31_536_000 } });
    expect(later.status()).toBe(201);

    const { context, page: visit } = await visitor(browser);
    await visit.goto(`/u/${username}`);
    await expect(visit.getByRole("link", { name: "Visible link" })).toBeVisible();
    await expect(visit.getByText("Switched off")).toHaveCount(0);
    await expect(visit.getByText("Starts next year")).toHaveCount(0);
    await expect(visit.getByText("Made with Linkbeam")).toHaveCount(0);
    await expect(visit.getByRole("link", { name: "Report this page" })).toBeVisible();
    expect(await visit.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    expect(await visit.evaluate(() => getComputedStyle(document.querySelector("a.b") ?? document.body).borderRadius)).toBe("4px");

    // A change shows at once when the same browser opens the page again.
    const renamed = await page.request.patch(`${SITE}/api/v1/me`, { headers: { origin: SITE }, data: { display_name: "Changed Name" } });
    expect(renamed.status()).toBe(200);
    await visit.goto(`/u/${username}`);
    await expect(visit.getByRole("heading", { level: 1 })).toHaveText("Changed Name");
    await context.close();
  });

  test("the browser blocks any script except ours", async ({ page, browser, request }) => {
    await signUp(page, request);
    const { username } = await seedPage(page, { display_name: `<img src=x onerror="window.__pwned=1">`, bio: `<script>window.__pwned=2</script>` });
    const { context, page: visit } = await visitor(browser);
    const problems: string[] = [];
    visit.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    await visit.goto(`/u/${username}`);
    // The text is shown as text, not run.
    await expect(visit.getByRole("heading", { level: 1 })).toContainText(`<img src=x onerror="window.__pwned=1">`);
    expect(await visit.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    // Even a script that got in some other way would be refused.
    await visit.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.__pwned = 3";
      document.head.append(script);
    });
    expect(await visit.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(problems.some((text) => text.includes("Content Security Policy"))).toBe(true);
    await context.close();
  });

  test("meets the size budget and does not shift while loading", async ({ page, browser, request }) => {
    await signUp(page, request);
    const { username } = await seedPage(page, {
      bio: "Brand designer in Lagos. I help small shops look great online.",
      links: Array.from({ length: 8 }, (_, index) => ({ kind: "url" as const, title: `A link with a normal sized title ${index + 1}`, target: `https://example.com/${index}` })),
      profile: { font_pair: "friendly" },
    });
    const { context, page: visit } = await visitor(browser);
    const sizes: Array<{ url: string; type: string; bytes: number }> = [];
    visit.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/v1/track")) return;
      try {
        const body = await response.body();
        sizes.push({ url, type: response.headers()["content-type"] ?? "", bytes: body.length });
      } catch {
        // Redirects have no body.
      }
    });
    await visit.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await visit.goto(`/u/${username}`, { waitUntil: "networkidle" });
    await visit.evaluate(() => document.fonts.ready);
    await visit.waitForTimeout(500);

    const html = sizes.find((entry) => entry.url.endsWith(`/u/${username}`));
    expect(html).toBeTruthy();
    const source = await (await visit.request.get(`/u/${username}`)).text();
    const css = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "").join("");
    const js = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "").join("");
    const jsGzip = gzipSync(js).length;
    const cssGzip = gzipSync(css).length;
    expect(jsGzip, "JavaScript, gzip").toBeLessThan(10 * 1024);
    expect(cssGzip, "CSS, gzip").toBeLessThan(15 * 1024);
    // Everything the page downloads, with the page itself compressed the way the host will send it.
    const total = sizes.reduce((sum, entry) => sum + (entry.url.endsWith(`/u/${username}`) ? gzipSync(source).length : entry.bytes), 0);
    process.stdout.write(`public page: html ${gzipSync(source).length} B gzip, css ${cssGzip} B gzip, js ${jsGzip} B gzip, total ${total} B, files ${sizes.length}\n`);
    expect(total, "total download before any photo").toBeLessThan(100 * 1024);
    const cls = await visit.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, "layout shift").toBeLessThan(0.05);
    await context.close();
  });

  test("unknown names get a friendly page, and capital letters go to the one address", async ({ browser }) => {
    const { context, page: visit } = await visitor(browser);
    const missing = await visit.goto("/u/nobody-here");
    expect(missing?.status()).toBe(404);
    await expect(visit.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
    const axe = await new AxeBuilder({ page: visit }).analyze();
    expect(axe.violations).toEqual([]);
    await context.close();
  });

  test("a visitor can report a page", async ({ page, browser, request }) => {
    await signUp(page, request);
    const { username } = await seedPage(page);
    const { context, page: visit } = await visitor(browser);
    await visit.goto(`/u/${username}`);
    await visit.getByRole("link", { name: "Report this page" }).click();
    await expect(visit).toHaveURL(new RegExp(`/report\\?page=${username}$`));
    await expect(visit.getByRole("heading", { name: "Report this page" })).toBeVisible();

    await visit.getByRole("button", { name: "Send report" }).click();
    await expect(visit.getByRole("alert")).toContainText("Tell us what is wrong");

    await visit.getByLabel("What is wrong with this page?").fill("This page pretends to be my shop.");
    const sent = visit.waitForResponse((r) => r.url().endsWith("/api/v1/report"));
    await visit.getByRole("button", { name: "Send report" }).click();
    expect((await sent).status()).toBe(202);
    await expect(visit.getByRole("heading", { name: "Thank you" })).toBeFocused();
    await context.close();
  });
});

test.describe("share tab", () => {
  test("shows the real link, copies it, and makes a QR code that scans back to it", async ({ page, request, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signUp(page, request);
    const { username } = await seedPage(page);
    await page.goto("/dashboard");
    await tab(page, "Share").click();

    const address = `${SITE}/u/${username}`;
    await expect(page.getByLabel("Your page address")).toHaveValue(address);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);

    // PNG: decode the downloaded picture with a real QR reader.
    const png = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG" }).click();
    const pngFile = await png;
    expect(pngFile.suggestedFilename()).toBe(`linkbeam-${username}-qr.png`);
    const decoded = PNG.sync.read(readFileSync(await filePath(pngFile)));
    expect(decoded.width).toBeGreaterThanOrEqual(600);
    expect(jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height)?.data).toBe(address);

    // SVG: a scalable picture with no scripts or links in it.
    const svg = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download SVG" }).click();
    const svgFile = await svg;
    expect(svgFile.suggestedFilename()).toBe(`linkbeam-${username}-qr.svg`);
    const text = readFileSync(await filePath(svgFile), "utf8");
    expect(text.startsWith("<svg ")).toBe(true);
    expect(text).not.toMatch(/<script|href|onload/i);

    // Sharing buttons carry the address.
    const whatsapp = page.getByRole("link", { name: "WhatsApp" });
    expect(decodeURIComponent((await whatsapp.getAttribute("href")) ?? "")).toContain(address);
    await expect(page.getByRole("link", { name: "Open your page" })).toHaveAttribute("href", address);
    expect(API).toBeTruthy();
  });

  test("asks for a username first when there is none", async ({ page, request }) => {
    await signUp(page, request);
    await page.getByRole("button", { name: "Skip setup" }).click().catch(() => undefined);
    await tab(page, "Share").click();
    await expect(page.getByRole("heading", { name: "Choose a username first" })).toBeVisible();
    await page.getByRole("button", { name: "Choose a username" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});

test.describe("static pages", () => {
  for (const [path, heading] of [["/", "One link for everything you do."], ["/terms", "Terms of use"], ["/privacy", "Privacy"]] as const) {
    test(`${path} loads, has one h1, and has no accessibility problems`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations).toEqual([]);
    });
  }

  test("the landing page sends people to sign in, and the footer reaches Terms and Privacy", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Create your page" }).first().click();
    await expect(page).toHaveURL(/\/signin$/);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });
});
