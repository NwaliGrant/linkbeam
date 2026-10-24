import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Red team rows 4 and 12 for the website: the built pages (what is really deployed) must carry a content security
// policy, must work under it with no violations, and must refuse an injected script.
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..", "..", "apps", "web");
const require = createRequire(join(webRoot, "package.json"));
const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;

let server: { stop: () => Promise<void> } | undefined;
test.beforeAll(async () => {
  const { preview } = (await import(require.resolve("astro"))) as { preview: (options: object) => Promise<{ stop: () => Promise<void> }> };
  server = await preview({ root: webRoot, logLevel: "warn", server: { port: PORT, host: "127.0.0.1" } });
});
test.afterAll(async () => {
  await server?.stop();
});

const PAGES = ["/", "/signin", "/dashboard", "/terms", "/privacy", "/report?page=someone"];

for (const path of PAGES) {
  test(`${path} has a policy, runs under it with no violations, and blocks an injected script`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __violations: string[] }).__violations = [];
      document.addEventListener("securitypolicyviolation", (event) => (window as unknown as { __violations: string[] }).__violations.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    await page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":{"code":"unauthorized","message":"Please sign in to continue."}}' }));
    await page.goto(BASE + path);
    await page.waitForLoadState("networkidle");

    const policy = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute("content");
    expect(policy, "policy present").toBeTruthy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toMatch(/script-src [^;]*'sha256-/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-eval'/);

    const own = await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
    expect(own, "the page's own scripts and styles are allowed").toEqual([]);

    // Attack: an injected inline script, an injected event handler and a script from another site must all be blocked.
    const result = await page.evaluate(async () => {
      (window as unknown as { __hit?: number }).__hit = 0;
      const inline = document.createElement("script");
      inline.textContent = "window.__hit = 1";
      document.body.appendChild(inline);
      const img = document.createElement("img");
      img.setAttribute("onerror", "window.__hit = 2");
      img.src = "/does-not-exist.png";
      document.body.appendChild(img);
      const remote = document.createElement("script");
      remote.src = "https://evil.example/x.js";
      document.body.appendChild(remote);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { hit: (window as unknown as { __hit: number }).__hit, violations: (window as unknown as { __violations: string[] }).__violations };
    });
    expect(result.hit).toBe(0);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
}

test("the built site ships a _headers file that forbids framing and sniffing", async ({ request }) => {
  const { readFileSync } = await import("node:fs");
  const headers = readFileSync(join(webRoot, "dist", "_headers"), "utf8");
  for (const line of ["X-Frame-Options: DENY", "frame-ancestors 'none'", "X-Content-Type-Options: nosniff", "Strict-Transport-Security", "Referrer-Policy"]) expect(headers).toContain(line);
  expect((await request.get(BASE + "/")).status()).toBe(200);
});
