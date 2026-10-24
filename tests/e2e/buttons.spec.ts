import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SITE, addUiLink, freshIp, seedPage, signUp, tab, type UiLink } from "./helpers";

// One owner builds a page with one button of every type through the dashboard. Visitors then use each button.
test.describe.configure({ mode: "serial" });

const LINKS: Record<string, UiLink> = {
  site: { kind: "url", title: "My portfolio", target: "https://example.com/portfolio" },
  whatsapp: { kind: "whatsapp", title: "Chat on WhatsApp", target: "+234 801 234 5678", message: "Hello Ada, I saw your page." },
  coffee: { kind: "coffee", title: "Buy me a coffee", target: "https://buymeacoffee.com/your-name" },
  call: { kind: "call", title: "Call the studio", target: "+2348012345678" },
  email: { kind: "email", title: "Email me", target: "Ada@Example.com" },
  mapAddress: { kind: "map", title: "Find the studio", target: "12 Herbert Macaulay Way, Yaba, Lagos" },
  mapLink: { kind: "map", title: "Open in Maps", target: "https://maps.app.goo.gl/abc123" },
};

let ownerContext: BrowserContext;
let owner: Page;
let username = "";
const ids: Record<string, string> = {};

async function visitor(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "cf-connecting-ip": freshIp() }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  // Nothing leaves this computer: every outside address is answered by the test.
  await page.route(/^https:\/\/(example\.com|wa\.me|buymeacoffee\.com|www\.google\.com|maps\.app\.goo\.gl)\//, (route) =>
    route.fulfill({ contentType: "text/html", body: `<title>Outside</title><h1>Outside site</h1><p id="u">${route.request().url()}</p>` }),
  );
  return { context, page };
}

async function clicks(): Promise<number> {
  const response = await owner.request.get(`${SITE}/api/v1/me/stats?days=7`);
  return ((await response.json()) as { totals: { clicks: number } }).totals.clicks;
}

test.beforeAll(async ({ browser, request }) => {
  ownerContext = await browser.newContext();
  owner = await ownerContext.newPage();
  await signUp(owner, request);
  ({ username } = await seedPage(owner, { display_name: "Ada Obi", bio: "Brand designer in Lagos.", links: [{ kind: "url", title: "Seed link", target: "https://example.com/seed" }] }));
  await owner.request.delete(`${SITE}/api/v1/links/${(await (await owner.request.get(`${SITE}/api/v1/links`)).json() as { links: Array<{ id: string }> }).links[0]?.id ?? ""}`, { headers: { origin: SITE } });
  await owner.goto("/dashboard");
  await tab(owner, "Links").click();
});
test.afterAll(async () => {
  await ownerContext.close();
});

test.describe("the owner adds every button type with the dashboard", () => {
  for (const [name, link] of Object.entries(LINKS)) {
    test(`adds: ${name}`, async () => {
      await addUiLink(owner, link);
    });
  }

  test("the list shows every button, and the coffee button shows its address", async () => {
    await expect(owner.locator(".link-summary", { hasText: "Buy me a coffee" })).toContainText("https://buymeacoffee.com/your-name");
    const links = ((await (await owner.request.get(`${SITE}/api/v1/links`)).json()) as { links: Array<{ id: string; title: string }> }).links;
    for (const [name, link] of Object.entries(LINKS)) ids[name] = links.find((item) => item.title === link.title)?.id ?? "";
    expect(Object.values(ids).every(Boolean)).toBe(true);
  });
});

test.describe("what a visitor gets from each button", () => {
  test("the page shows all seven buttons in order, with the right addresses", async ({ browser }) => {
    const { context, page } = await visitor(browser);
    await page.goto(`/u/${username}`);
    const href = (name: string) => page.getByRole("link", { name: LINKS[name]?.title ?? "" }).getAttribute("href");
    expect(await href("site")).toBe("https://example.com/portfolio");
    expect(await href("whatsapp")).toBe("https://wa.me/2348012345678?text=Hello%20Ada%2C%20I%20saw%20your%20page.");
    expect(await href("coffee")).toBe("https://buymeacoffee.com/your-name");
    expect(await href("call")).toBe("tel:+2348012345678");
    expect(await href("email")).toBe("mailto:ada@example.com");
    expect(await href("mapAddress")).toBe("https://www.google.com/maps/search/?api=1&query=12%20Herbert%20Macaulay%20Way%2C%20Yaba%2C%20Lagos");
    expect(await href("mapLink")).toBe("https://maps.app.goo.gl/abc123");
    await expect(page.getByText(/bank|account number|pay me/i)).toHaveCount(0);
    await context.close();
  });

  for (const [name, expectedUrl] of [
    ["site", "https://example.com/portfolio"],
    ["whatsapp", "https://wa.me/2348012345678?text=Hello%20Ada%2C%20I%20saw%20your%20page."],
    ["coffee", "https://buymeacoffee.com/your-name"],
    ["mapAddress", "https://www.google.com/maps/search/?api=1&query=12%20Herbert%20Macaulay%20Way%2C%20Yaba%2C%20Lagos"],
    ["mapLink", "https://maps.app.goo.gl/abc123"],
  ] as const) {
    test(`tapping ${name} opens its address and is counted`, async ({ browser }) => {
      const before = await clicks();
      const { context, page } = await visitor(browser);
      await page.goto(`/u/${username}`);
      await page.getByRole("link", { name: LINKS[name]?.title ?? "" }).click();
      await expect(page.locator("#u")).toHaveText(expectedUrl);
      await expect.poll(clicks, { timeout: 10_000 }).toBe(before + 1);
      await context.close();
    });
  }

  for (const name of ["call", "email"] as const) {
    test(`tapping ${name} is counted (the phone or mail app takes over)`, async ({ browser }) => {
      const before = await clicks();
      const { context, page } = await visitor(browser);
      await page.goto(`/u/${username}`);
      const sent = page.waitForRequest((request) => request.url().endsWith("/api/v1/track") && (request.postData() ?? "").includes(ids[name] ?? "x"));
      // A phone or mail address cannot open in a test browser, so stop the jump and keep the real click and its count.
      await page.getByRole("link", { name: LINKS[name]?.title ?? "" }).evaluate((a) => a.addEventListener("click", (event) => event.preventDefault()));
      await page.getByRole("link", { name: LINKS[name]?.title ?? "" }).click();
      await sent;
      await expect.poll(clicks, { timeout: 10_000 }).toBe(before + 1);
      await context.close();
    });
  }
});

test.describe("the owner edits and the page follows", () => {
  test("changing the coffee address changes the button, and a wrong address is refused", async ({ browser }) => {
    await owner.goto("/dashboard");
    await tab(owner, "Links").click();
    const row = owner.locator("[data-link-row]", { hasText: "Buy me a coffee" });
    await row.getByRole("button", { name: /^Edit/ }).click();
    const box = row.getByLabel("Your Buy Me a Coffee address");
    await box.fill("https://paystack.com/pay/x");
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await box.fill("https://buymeacoffee.com/second-name");
    await expect(owner.getByText("Saved", { exact: false }).first()).toBeVisible();
    await expect(owner.locator(".link-summary", { hasText: "Buy me a coffee" })).toContainText("second-name");

    const { context, page } = await visitor(browser);
    await page.goto(`/u/${username}`);
    expect(await page.getByRole("link", { name: "Buy me a coffee" }).getAttribute("href")).toBe("https://buymeacoffee.com/second-name");
    await context.close();
  });

  test("the owner can switch the coffee button off, so it is optional", async ({ browser }) => {
    const row = owner.locator("[data-link-row]", { hasText: "Buy me a coffee" });
    await row.locator('input[type="checkbox"]').first().uncheck();
    await expect(owner.getByText("Saved", { exact: false }).first()).toBeVisible();
    const { context, page } = await visitor(browser);
    await page.goto(`/u/${username}`);
    await expect(page.getByRole("link", { name: "Buy me a coffee" })).toHaveCount(0);
    await context.close();
  });
});

test.describe("the forms explain mistakes in plain words and send nothing", () => {
  async function openForm() {
    await owner.goto("/dashboard");
    await tab(owner, "Links").click();
    await owner.getByRole("button", { name: "Add link", exact: true }).first().click();
    return owner.getByRole("form", { name: "Add a link" });
  }
  async function count(): Promise<number> {
    return ((await (await owner.request.get(`${SITE}/api/v1/links`)).json()) as { links: unknown[] }).links.length;
  }

  for (const [kind, label, bad, message] of [
    ["whatsapp", "WhatsApp number", "08012345678", /country code/],
    ["call", "Phone number", "call me", /valid phone number/],
    ["email", "Email address", "ada@example.com?cc=a@b.co", /valid email address/],
    ["coffee", "Your Buy Me a Coffee address", "https://paystack.com/pay/x", /Buy Me a Coffee address/],
    ["map", "Address or map link", "javascript:alert(1)", /valid address or map link/],
    ["url", "Web address", "javascript:alert(1)", /valid web address/],
  ] as const) {
    test(`${kind}: refuses ${bad}`, async () => {
      const before = await count();
      const form = await openForm();
      await form.getByLabel("Type of link").selectOption(kind);
      await form.getByLabel("Title").fill("Bad one");
      await form.getByLabel(label).fill(bad);
      await form.getByRole("button", { name: "Add link", exact: true }).click();
      await expect(form.getByLabel(label)).toHaveAttribute("aria-invalid", "true");
      await expect(form.locator(".error-message")).toContainText(message);
      expect(await count()).toBe(before);
    });
  }
});
