import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { addLinkViaUi, freshEmail, freshIp, linkFor, linkTitle, signUp, SITE, tab } from "./helpers";

test.describe("signed-out", () => {
  test("the dashboard sends a signed-out visitor to the sign-in page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole("heading", { name: "Sign in to Linkbeam" })).toBeVisible();
  });

  test("sign in by email with the real flow, then land in setup", async ({ page, context }) => {
    const email = freshEmail();
    await context.setExtraHTTPHeaders({ "cf-connecting-ip": freshIp() });
    await page.goto("/signin");
    // Typing before the page code has loaded must not lose the text.
    await page.getByLabel("Email address").fill("not-an-email");
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
    await expect(page.getByLabel("Email address")).toHaveValue("not-an-email");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("alert")).toContainText("valid email address");

    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
    await expect(page.getByText(email)).toBeVisible();

    await page.goto(await linkFor(email));
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Choose your username" })).toBeVisible();
  });

  test("an old or invalid link shows a clear message", async ({ page }) => {
    await page.goto(`/api/v1/auth/callback?token=${"A".repeat(43)}`);
    await expect(page).toHaveURL(/\/signin\?error=invalid_link/);
    await expect(page.getByRole("alert")).toContainText("did not work");
  });

  test("Google sign-in says it is not available when it is not set up", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("link", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/error=provider_unavailable/);
    await expect(page.getByRole("alert")).toContainText("not available yet");
  });
});

test.describe("new account", () => {
  test("setup: username, name and photo, first link, then the editor", async ({ page, request }) => {
    await signUp(page, request);

    // Step 1
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await page.getByLabel("Username").fill("a b");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("Use only a-z");
    await page.getByLabel("Username").fill("admin");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("reserved");
    const username = `e2e${Date.now().toString(36)}`;
    await page.getByLabel("Username").fill(username);
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: a big photo is made small in the browser before it is sent.
    await expect(page.getByRole("heading", { name: "Your name and photo" })).toBeFocused();
    const big = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: { r: 20, g: 120, b: 80 } } }).jpeg({ quality: 95 }).toBuffer();
    expect(big.length).toBeGreaterThan(20_000);
    await page.locator('input[type="file"]').setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: big });
    const photo = page.getByRole("img", { name: "Your photo" });
    await expect(photo).toBeVisible();
    // What was stored is small and square, not the 3200 x 2000 original.
    const stored = await page.request.get((await photo.getAttribute("src")) ?? "");
    expect(stored.status()).toBe(200);
    const bytes = await stored.body();
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBeLessThanOrEqual(512);
    expect(meta.width).toBe(meta.height);
    expect(bytes.length).toBeLessThan(big.length / 2);
    expect(bytes.length).toBeLessThan(100_000);
    await expect(page.getByRole("img", { name: "Your photo" })).toBeVisible();
    await page.getByLabel("Display name").fill("Ada Obi");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3
    await expect(page.getByRole("heading", { name: "Add your first link" })).toBeVisible();
    await page.getByLabel("Title").fill("My shop");
    await page.getByLabel("Web address").fill("not a web address");
    await page.getByRole("button", { name: "Add link and finish" }).click();
    await expect(page.getByText("is not a valid web address")).toBeVisible();
    await page.getByLabel("Web address").fill("https://example.com/shop");
    await page.getByRole("button", { name: "Add link and finish" }).click();

    // The editor, with the preview already showing the new page.
    await expect(page.getByRole("heading", { name: "Your links" })).toBeVisible();
    await expect(linkTitle(page, "My shop")).toBeVisible();
    const phone = page.locator(".phone");
    await expect(phone).toContainText("Ada Obi");
    await expect(phone).toContainText("My shop");
    await expect(phone.locator("img.p-avatar")).toBeVisible();

    // Setup does not come back after reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your links" })).toBeVisible();
  });

  test("setup can be skipped, and the editor explains what is missing", async ({ page, request }) => {
    await signUp(page, request);
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(page.getByRole("heading", { name: "Your links" })).toBeVisible();
    await expect(page.getByText("Choose a username in Settings")).toBeVisible();
    await expect(page.getByText("No links yet")).toBeVisible();
  });
});

test.describe("editor", () => {
  test.beforeEach(async ({ page, request }) => {
    await signUp(page, request);
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(page.getByRole("heading", { name: "Your links" })).toBeVisible();
  });

  test("add, edit with autosave, and keep the edit after a reload", async ({ page }) => {
    await addLinkViaUi(page, "Portfolio", "https://example.com/work");
    await expect(page.locator(".phone")).toContainText("Portfolio");

    await page.getByRole("button", { name: /Edit\s+Portfolio/ }).click();
    const title = page.getByLabel("Title");
    await title.fill("");
    await expect(page.getByText("Add a title.")).toBeVisible();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await title.fill("My portfolio");
    await expect(page.locator(".phone")).toContainText("My portfolio");
    await expect(page.getByText("Saved")).toBeVisible();

    await page.getByLabel("Web address").fill("javascript:alert(1)");
    await expect(page.getByText(/not a valid web address/)).toBeVisible();

    await page.reload();
    await expect(linkTitle(page, "My portfolio")).toBeVisible();
    await expect(page.getByText("https://example.com/work")).toBeVisible();
  });

  test("a link can be switched off and then disappears from the preview", async ({ page }) => {
    await addLinkViaUi(page, "Hidden soon", "https://example.com/a");
    await expect(page.locator(".phone")).toContainText("Hidden soon");
    await page.getByRole("checkbox", { name: /show Hidden soon/ }).uncheck();
    await expect(page.locator(".phone")).not.toContainText("Hidden soon");
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /show Hidden soon/ })).not.toBeChecked();
  });

  test("reorder with the arrow buttons, with an announcement, and it sticks after reload", async ({ page }) => {
    for (const name of ["One", "Two", "Three"]) await addLinkViaUi(page, name, `https://example.com/${name.toLowerCase()}`);
    const titles = () => page.locator(".link-list .link-summary strong").allInnerTexts();
    expect((await titles()).map((t) => t.trim())).toEqual(["One", "Two", "Three"]);

    await expect(page.getByRole("button", { name: "Move One up" })).toBeDisabled();
    await page.getByRole("button", { name: "Move Three up" }).click();
    await expect(page.locator("[aria-live=polite].sr-only")).toContainText("Three moved to position 2 of 3");
    await page.getByRole("button", { name: "Move One down" }).click();
    await expect.poll(async () => (await titles()).map((t) => t.trim())).toEqual(["Three", "One", "Two"]);
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect.poll(async () => (await titles()).map((t) => t.trim())).toEqual(["Three", "One", "Two"]);
  });

  test("reorder by dragging the handle", async ({ page }) => {
    for (const name of ["Alpha", "Beta", "Gamma"]) await addLinkViaUi(page, name, `https://example.com/${name.toLowerCase()}`);
    const titles = () => page.locator(".link-list .link-summary strong").allInnerTexts();
    const handle = page.getByRole("button", { name: /Drag to move Alpha/ });
    const box = await handle.boundingBox();
    const target = await page.getByRole("button", { name: /Drag to move Gamma/ }).boundingBox();
    if (!box || !target) throw new Error("no boxes");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, (box.y + target.y) / 2 + 20, { steps: 5 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await titles()).map((t) => t.trim())).toEqual(["Beta", "Gamma", "Alpha"]);
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect.poll(async () => (await titles()).map((t) => t.trim())).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  test("delete can be undone, and an unreversed delete is final", async ({ page }) => {
    await addLinkViaUi(page, "Keep me", "https://example.com/keep");
    await addLinkViaUi(page, "Remove me", "https://example.com/remove");

    await page.getByRole("button", { name: /Delete\s+Keep me/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "was deleted" })).toBeVisible();
    await expect(page.locator(".phone")).not.toContainText("Keep me");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(linkTitle(page, "Keep me")).toBeVisible();
    await expect(page.locator(".phone")).toContainText("Keep me");

    const deleted = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/api/v1/links/"));
    await page.getByRole("button", { name: /Delete\s+Remove me/ }).click();
    await page.getByRole("button", { name: "Close message" }).click();
    await page.getByRole("button", { name: /Delete\s+Keep me/ }).click(); // starts a second delete, which commits the first at once
    expect((await deleted).status()).toBe(204);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.reload();
    await expect(linkTitle(page, "Keep me")).toBeVisible();
    await expect(linkTitle(page, "Remove me")).toHaveCount(0);
  });

  test("the link limit is explained", async ({ page, request }) => {
    // 30 links through the API is quicker than 30 forms. The page must then stop offering "Add link".
    const cookie = (await page.context().cookies()).find((c) => c.name === "__Host-lb_session");
    for (let i = 0; i < 30; i++) {
      const r = await request.post(`${SITE}/api/v1/links`, { headers: { origin: SITE, cookie: `__Host-lb_session=${cookie?.value}` }, data: { title: `L${i}`, target: `https://example.com/${i}` } });
      expect(r.status()).toBe(201);
    }
    await page.reload();
    await expect(page.getByText("30 of 30 used")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add link" })).toBeDisabled();
    await expect(page.getByText("You have reached the limit of 30 links")).toBeVisible();
  });

  test("a failed save is shown, and Try again saves it", async ({ page }) => {
    await addLinkViaUi(page, "Flaky", "https://example.com/flaky");
    let failures = 1;
    await page.route("**/api/v1/links/*", async (route) => {
      if (route.request().method() === "PATCH" && failures-- > 0) return route.abort("failed");
      return route.continue();
    });
    await page.getByRole("button", { name: /Edit\s+Flaky/ }).click();
    await page.getByLabel("Title").fill("Flaky 2");
    await expect(page.getByText("Not saved.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(linkTitle(page, "Flaky 2")).toBeVisible();
  });

  test("the design tab changes the preview, warns about unreadable colours, and saves", async ({ page }) => {
    await addLinkViaUi(page, "Styled", "https://example.com/styled");
    await tab(page, "Design").click();
    const button = page.locator(".phone .p-btn").first();
    const before = await button.evaluate((el) => getComputedStyle(el).backgroundColor);

    await page.getByRole("radio", { name: "Sunset" }).check({ force: true });
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
    await page.getByRole("radio", { name: "Square" }).check({ force: true });
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("4px");
    await page.getByRole("radio", { name: "Clean" }).check({ force: true });
    await page.getByRole("radio", { name: "Dots" }).check({ force: true });
    await expect.poll(() => page.locator(".phone-screen").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("radial-gradient");

    await expect(page.getByRole("status").getByText("hard to read")).toHaveCount(0);
    await page.getByLabel("Button colour", { exact: true }).fill("#777777");
    await expect(page.getByText(/Text on your buttons will be hard to read/)).toBeVisible();
    await page.getByLabel("Button colour", { exact: true }).fill("#0B6B3A");
    await expect(page.getByText(/hard to read/)).toHaveCount(0);
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(11, 107, 58)");

    await page.getByRole("checkbox", { name: /Made with Linkbeam/ }).uncheck();
    await expect(page.locator(".phone")).not.toContainText("Made with Linkbeam");
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await tab(page, "Design").click();
    await expect(page.getByRole("radio", { name: "Sunset" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Square" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Dots" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Made with Linkbeam/ })).not.toBeChecked();
  });

  test("stats show an empty state with advice", async ({ page }) => {
    await tab(page, "Stats").click();
    await expect(page.getByRole("heading", { name: "No visits yet" })).toBeVisible();
    await page.getByRole("button", { name: "30 days" }).click();
    await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Page views")).toBeVisible();
  });

  test("settings: bio autosaves, username can be chosen, and sign out of all devices works", async ({ page }) => {
    await tab(page, "Settings").click();
    await page.getByLabel("Bio").fill("Designer in Lagos");
    await expect(page.getByText("17 of 160")).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.getByLabel("Username").fill("x");
    await page.getByRole("button", { name: "Save username" }).click();
    await expect(page.getByText(/Use 3 to 30 characters/)).toBeVisible();
    const username = `set${Date.now().toString(36)}`;
    await page.getByLabel("Username").fill(username);
    await page.getByRole("button", { name: "Save username" }).click();
    await expect(page.getByText("Username saved.")).toBeVisible();
    await expect(page.getByText("Choose a username in Settings")).toHaveCount(0);

    await page.getByRole("button", { name: "Sign out of all devices" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("delete account needs the username typed, then removes everything", async ({ page }) => {
    await tab(page, "Settings").click();
    const username = `del${Date.now().toString(36)}`;
    await page.getByLabel("Username").first().fill(username);
    await page.getByRole("button", { name: "Save username" }).click();
    await expect(page.getByText("Username saved.")).toBeVisible();

    const remove = page.getByRole("button", { name: "Delete my account" });
    await expect(remove).toBeDisabled();
    await page.getByLabel(/Type .* to confirm/).fill("wrong");
    await expect(remove).toBeDisabled();
    await page.getByLabel(/Type .* to confirm/).fill(username);
    await remove.click();
    await expect(page).toHaveURL(/\/\?deleted=1$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/signin$/);
  });
});
