import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { SITE, freshIp, inspect, seedPage, signUp, tab } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "docs", "evidence", "stage5");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;
const SCHEMES = ["light", "dark"] as const;

const LINKS = [
  { kind: "url" as const, title: "My portfolio", target: "https://example.com/portfolio" },
  { kind: "whatsapp" as const, title: "Chat with me on WhatsApp", target: "+2348012345678", message: "Hello Ada, I saw your page." },
  { kind: "coffee" as const, title: "Buy me a coffee", target: "https://buymeacoffee.com/your-name" },
  { kind: "call" as const, title: "Call the studio", target: "+2348012345678" },
  { kind: "email" as const, title: "Email me", target: "ada@example.com" },
  { kind: "map" as const, title: "Visit the studio in Yaba", target: "12 Herbert Macaulay Way, Yaba, Lagos" },
];

async function shot(page: Page, screen: string, viewport: string, scheme: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${screen}-${viewport}-${scheme}.png`), fullPage: false });
}

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test(`Stage 5 screens at ${viewport.name} in ${scheme} mode`, async ({ browser, request }) => {
      test.setTimeout(180_000);
      const v = viewport.name;
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme, reducedMotion: "reduce", extraHTTPHeaders: { "cf-connecting-ip": freshIp() } });
      const owner = await context.newPage();
      await signUp(owner, request);
      const { username } = await seedPage(owner, { display_name: "Ada Obi", bio: "Brand designer in Lagos.", links: LINKS });

      await owner.goto("/dashboard");
      await tab(owner, "Links").click();
      await expect(owner.locator(".link-summary", { hasText: "Buy me a coffee" })).toBeVisible();
      await inspect(owner, "links-list", v, scheme);
      await shot(owner, "links-list", v, scheme);

      await owner.getByRole("button", { name: "Add link", exact: true }).first().click();
      const form = owner.getByRole("form", { name: "Add a link" });
      await form.getByLabel("Type of link").selectOption("coffee");
      await expect(form.getByLabel("Your Buy Me a Coffee address")).toHaveAttribute("placeholder", "https://buymeacoffee.com/your-name");
      await inspect(owner, "add-coffee", v, scheme);
      await shot(owner, "add-coffee", v, scheme);

      await form.getByLabel("Title").fill("Buy me a coffee");
      await form.getByLabel("Your Buy Me a Coffee address").fill("https://paystack.com/pay/x");
      await form.getByRole("button", { name: "Add link", exact: true }).click();
      await expect(form.locator(".error-message")).toBeVisible();
      await inspect(owner, "add-coffee-error", v, scheme);
      await shot(owner, "add-coffee-error", v, scheme);

      await owner.goto(`/u/${username}`);
      await expect(owner.getByRole("link", { name: "Buy me a coffee" })).toBeVisible();
      await inspect(owner, "public-buttons", v, scheme);
      await shot(owner, "public-buttons", v, scheme);

      await context.close();
      expect(SITE).toBeTruthy();
    });
  }
}
