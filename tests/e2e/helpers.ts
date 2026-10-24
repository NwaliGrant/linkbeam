import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", "..", ".e2e", "api.log");
export const SITE = "http://localhost:4321";
export const API = "http://localhost:8787";

let counter = 0;
/** Each test person gets their own made-up network address, so the per-IP limits never mix them up. Works on localhost only. */
export const freshIp = (): string => `10.20.${Math.floor(Date.now() / 1000) % 250}.${(counter++ % 250) + 1}`;
export const freshEmail = (): string => `e2e-${Date.now()}-${counter++}@example.com`;

/** The newest sign-in link printed for an address by the console mailer. */
export async function linkFor(email: string): Promise<string> {
  const pattern = new RegExp(`Sign-in link for ${email.replace(/[.+]/g, "\\$&")}: (\\S+)`, "g");
  for (let attempt = 0; attempt < 50; attempt++) {
    const matches = [...readFileSync(LOG, "utf8").matchAll(pattern)];
    const last = matches.at(-1);
    if (last?.[1]) return last[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No sign-in link was printed for ${email}`);
}

/** Signs a new person in the way a real one does: asks for a link, then opens it in the browser. */
export async function signUp(page: Page, request: APIRequestContext): Promise<{ email: string; ip: string }> {
  const email = freshEmail();
  const ip = freshIp();
  await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": ip });
  const asked = await request.post(`${API}/api/v1/auth/magic-link`, { headers: { origin: SITE, "cf-connecting-ip": ip }, data: { email } });
  expect(asked.status()).toBe(202);
  await page.goto(await linkFor(email));
  await expect(page).toHaveURL(/\/dashboard$/);
  return { email, ip };
}

/** A section button in the dashboard's tab bar (not the dev toolbar). */
export const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("button", { name });

/** The visible title of one link in the list. */
export const linkTitle = (page: Page, title: string) =>
  page.locator(".link-summary strong").filter({ hasText: new RegExp(`^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });

export async function addLinkViaUi(page: Page, title: string, target: string): Promise<void> {
  await page.getByRole("button", { name: "Add link" }).or(page.getByRole("button", { name: "Add your first link" })).first().click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Web address").fill(target);
  await page.getByRole("button", { name: "Add link", exact: true }).last().click();
  await expect(linkTitle(page, title)).toBeVisible();
}

/** Every check that must hold on every screen: no serious accessibility problems, no sideways scroll, big enough tap targets. */
export async function inspect(page: Page, screen: string, viewport: string, scheme: string): Promise<void> {
  const label = `${screen} @ ${viewport} ${scheme}`;
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")})`), `axe on ${label}`).toEqual([]);
  // Not even moderate or minor problems are expected. They are listed so they are seen, not hidden.
  const minor = axe.violations.filter((v) => v.impact === "moderate" || v.impact === "minor");
  expect(minor.map((v) => `${v.id}: ${v.help}`), `axe (moderate/minor) on ${label}`).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `sideways scroll on ${label}`).toBeLessThanOrEqual(0);

  const small = await page.evaluate(() => {
    const found: string[] = [];
    const selector = 'button, a[href], select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])';
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest(".phone") || el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width < 43.5 || box.height < 43.5) found.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    return found;
  });
  expect(small, `tap targets under 44px on ${label}`).toEqual([]);

  const fonts = await page.evaluate(() => {
    const found: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]), textarea, select')) {
      if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 16) found.push(el.id || el.tagName);
    }
    return found;
  });
  expect(fonts, `form text under 16px on ${label}`).toEqual([]);
}

export interface SeedLink {
  kind: "url" | "whatsapp" | "coffee" | "call" | "email" | "map";
  title: string;
  target: string;
  message?: string;
}

/** Gives the signed-in person a username and some links, using the same API the dashboard uses. */
export async function seedPage(
  page: Page,
  options: { display_name?: string; bio?: string; links?: SeedLink[]; profile?: Record<string, unknown> } = {},
): Promise<{ username: string; ids: string[] }> {
  const username = `pg${Date.now().toString(36)}${(counter++ % 1000).toString(36)}`.slice(0, 30);
  const mine = await page.request.patch(`${SITE}/api/v1/me`, {
    headers: { origin: SITE },
    data: { username, display_name: options.display_name ?? "Ada Obi", bio: options.bio ?? "Brand designer in Lagos.", ...options.profile },
  });
  expect(mine.status()).toBe(200);
  const ids: string[] = [];
  for (const link of options.links ?? [{ kind: "url", title: "My portfolio", target: "https://example.com/portfolio" }]) {
    const response = await page.request.post(`${SITE}/api/v1/links`, { headers: { origin: SITE }, data: link });
    expect(response.status()).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  return { username, ids };
}

export interface UiLink {
  kind: "url" | "whatsapp" | "coffee" | "call" | "email" | "map";
  title: string;
  target: string;
  message?: string;
}

const TARGET_LABELS: Record<UiLink["kind"], string> = {
  url: "Web address",
  whatsapp: "WhatsApp number",
  coffee: "Your Buy Me a Coffee address",
  call: "Phone number",
  email: "Email address",
  map: "Address or map link",
};

/** Adds a link the way a person does, with the dashboard's own form. Returns once it shows in the list. */
export async function addUiLink(page: Page, link: UiLink): Promise<void> {
  const open = page.getByRole("button", { name: "Add link", exact: true }).or(page.getByRole("button", { name: "Add your first link" })).first();
  const form = page.getByRole("form", { name: "Add a link" });
  if (!(await form.isVisible())) await open.click();
  await form.getByLabel("Type of link").selectOption(link.kind);
  await form.getByLabel("Title").fill(link.title);
  await form.getByLabel(TARGET_LABELS[link.kind]).fill(link.target);
  if (link.message) await form.getByLabel("First message (optional)").fill(link.message);
  await form.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(linkTitle(page, link.title)).toBeVisible();
}
