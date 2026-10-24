import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";
import lighthouse from "lighthouse";
import sharp from "sharp";
import { SITE, seedPage, signUp } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "docs", "evidence", "stage4");
mkdirSync(OUT, { recursive: true });
const DEBUG_PORT = 9333;

const ROOT = join(here, "..", "..");
const PREVIEW = "http://localhost:4322";

/** The landing, Terms and Privacy pages are audited from the real production build, not the development server. */
async function startPreview(): Promise<() => void> {
  const build = spawnSync("pnpm", ["--filter", "@linkbeam/web", "build"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) throw new Error("The site build failed");
  const child = spawn("pnpm", ["exec", "astro", "preview", "--port", "4322", "--host", "localhost"], { cwd: join(ROOT, "apps", "web"), stdio: "ignore" });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${PREVIEW}/terms`)).ok) return () => child.kill("SIGTERM");
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill("SIGTERM");
  throw new Error("The preview server did not start");
}

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

test("Lighthouse scores are 95 or higher on a throttled mobile profile", async ({ page, request }) => {
  // A realistic page: a name, a bio, a photo, and six buttons.
  await signUp(page, request);
  const { username } = await seedPage(page, {
    display_name: "Ada Obi",
    bio: "Brand designer in Lagos. I help small shops look great online.",
    profile: { font_pair: "friendly" },
    links: [
      { kind: "url", title: "My portfolio", target: "https://example.com/portfolio" },
      { kind: "whatsapp", title: "Chat with me on WhatsApp", target: "+2348012345678", message: "Hello Ada" },
      { kind: "coffee", title: "Buy me a coffee", target: "https://buymeacoffee.com/your-name" },
      { kind: "call", title: "Call the studio", target: "+2348012345678" },
      { kind: "email", title: "Email me", target: "ada@example.com" },
      { kind: "map", title: "Visit the studio in Yaba", target: "https://maps.google.com/?q=Yaba+Lagos" },
    ],
  });
  const jpeg = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 11, g: 107, b: 58 } } }).jpeg({ quality: 85 }).toBuffer();
  const upload = await page.request.post(`${SITE}/api/v1/me/avatar`, { headers: { origin: SITE }, multipart: { file: { name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg } } });
  expect(upload.status()).toBe(201);

  const executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: [`--remote-debugging-port=${DEBUG_PORT}`] });
  const stopPreview = await startPreview();
  const targets = [
    { name: "public-page", url: `${SITE}/u/${username}` },
    { name: "landing", url: `${PREVIEW}/` },
    { name: "terms", url: `${PREVIEW}/terms` },
    { name: "privacy", url: `${PREVIEW}/privacy` },
  ];
  const summary: Record<string, unknown> = {};
  try {
    for (const target of targets) {
      // Lighthouse's own defaults: a mid-range phone, slow 4G, and a slowed-down processor.
      const result = await lighthouse(target.url, { port: DEBUG_PORT, output: "html", logLevel: "error", onlyCategories: [...CATEGORIES] });
      if (!result) throw new Error("Lighthouse returned nothing");
      const { lhr } = result;
      const scores = Object.fromEntries(CATEGORIES.map((key) => [key, Math.round((lhr.categories[key]?.score ?? 0) * 100)]));
      const audit = (id: string) => lhr.audits[id]?.numericValue;
      const metrics = {
        lcp_ms: Math.round(audit("largest-contentful-paint") ?? -1),
        cls: Number((audit("cumulative-layout-shift") ?? -1).toFixed(4)),
        tbt_ms: Math.round(audit("total-blocking-time") ?? -1),
        fcp_ms: Math.round(audit("first-contentful-paint") ?? -1),
        total_bytes: Math.round(audit("total-byte-weight") ?? -1),
      };
      const failed = Object.values(lhr.audits)
        .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual")
        .map((a) => `${a.id}: ${a.score}`);
      summary[target.name] = { url: target.url.replace(username, "<username>"), scores, metrics, audits_below_100: failed };
      process.stdout.write(`${target.name} ${JSON.stringify({ scores, metrics })}\n`);
      if (target.name === "public-page") writeFileSync(join(OUT, "lighthouse-public-page.html"), Array.isArray(result.report) ? (result.report[0] ?? "") : result.report);

      for (const key of CATEGORIES) expect(scores[key], `${target.name} ${key}`).toBeGreaterThanOrEqual(95);
      if (target.name === "public-page") {
        expect(metrics.lcp_ms, "LCP (ms)").toBeLessThan(1800);
        expect(metrics.cls, "CLS").toBeLessThan(0.05);
      }
    }
  } finally {
    writeFileSync(join(OUT, "lighthouse-summary.json"), `${JSON.stringify({ tool: "lighthouse 13.5.0, mobile profile with simulated slow-4G and 4x CPU slowdown, against localhost", results: summary }, null, 2)}\n`);
    await browser.close();
    stopPreview();
  }
});
