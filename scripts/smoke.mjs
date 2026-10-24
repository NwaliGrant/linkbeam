// Post-deploy smoke test. Read-only: it only reads pages and sends a few requests that must be refused.
// Run it ONLY against a site you own.
//   node scripts/smoke.mjs https://linkbeam.your-name.workers.dev
//   node scripts/smoke.mjs http://localhost:8791          (a local copy: pnpm exec wrangler dev -c wrangler.deploy.toml)
// Exit code 0 when every check passes, 1 otherwise.
const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node scripts/smoke.mjs <site address>");
  process.exit(2);
}
const base = new URL(raw);
const local = ["localhost", "127.0.0.1"].includes(base.hostname);
if (base.protocol !== "https:" && !local) {
  console.error("A live site must use https.");
  process.exit(2);
}

const results = [];
async function check(name, run) {
  try {
    const note = await run();
    results.push({ name, ok: true, note: note ?? "" });
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const get = (path, init = {}) => fetch(new URL(path, base), { redirect: "manual", ...init });
const header = (response, name) => response.headers.get(name) ?? "";

await check("API health answers ok", async () => {
  const response = await get("/api/v1/health");
  expect(response.status === 200, `status ${response.status}`);
  expect((await response.json()).ok === true, "body is not ok:true");
});

for (const path of ["/", "/signin", "/terms", "/privacy", "/dashboard", "/report"]) {
  await check(`Page ${path} loads, with a policy and no redirect`, async () => {
    const response = await get(path);
    expect(response.status === 200, `status ${response.status}`);
    expect(header(response, "content-type").includes("text/html"), "not html");
    const html = await response.text();
    expect(/http-equiv="content-security-policy"/i.test(html), "no content security policy in the page");
    expect(!/script-src[^;"]*'unsafe-(inline|eval)'/.test(html), "script policy allows unsafe code");
    expect(html.includes('rel="manifest"'), "no manifest link");
  });
}

await check("Security headers on the website", async () => {
  const response = await get("/terms");
  expect(header(response, "x-content-type-options") === "nosniff", "x-content-type-options missing");
  expect(header(response, "x-frame-options").toUpperCase() === "DENY", "x-frame-options missing");
  expect(/frame-ancestors 'none'/.test(header(response, "content-security-policy")), "frame-ancestors missing");
  expect(header(response, "referrer-policy") !== "", "referrer-policy missing");
  if (!local) expect(/max-age=\d+/.test(header(response, "strict-transport-security")), "HSTS missing");
});

await check("Unknown website address gives the friendly 404 page", async () => {
  const response = await get("/no-such-page-smoke", { headers: { "sec-fetch-mode": "navigate" } });
  expect(response.status === 404, `status ${response.status}`);
  expect((await response.text()).includes("This page does not exist"), "friendly text missing");
});

await check("Unknown public page gives 404 HTML with a strict policy", async () => {
  const response = await get("/u/no-such-person-smoke");
  expect(response.status === 404, `status ${response.status}`);
  expect(header(response, "content-type").includes("text/html"), "not html");
  expect(/default-src 'none'/.test(header(response, "content-security-policy")), "policy is not strict");
  expect(header(response, "x-robots-tag").includes("noindex"), "missing noindex");
});

await check("Manifest and service worker are served correctly", async () => {
  const manifest = await get("/manifest.webmanifest");
  expect(manifest.status === 200, `manifest status ${manifest.status}`);
  expect(header(manifest, "content-type").includes("manifest"), `manifest type ${header(manifest, "content-type")}`);
  const worker = await get("/sw.js");
  expect(worker.status === 200, `sw.js status ${worker.status}`);
  expect(/javascript/.test(header(worker, "content-type")), "sw.js type");
  expect(/no-cache|max-age=0|must-revalidate/.test(header(worker, "cache-control")), `sw.js may be cached: "${header(worker, "cache-control")}"`);
  const icon = await get("/icons/icon-192.png");
  expect(icon.status === 200 && header(icon, "content-type").includes("png"), "icon missing");
});

await check("Signed-out API call is refused with JSON", async () => {
  const response = await get("/api/v1/me");
  expect(response.status === 401, `status ${response.status}`);
  expect(header(response, "content-type").includes("json"), "not json");
});

await check("A cross-site sign-in request is refused (CSRF)", async () => {
  const response = await get("/api/v1/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ email: "smoke@example.com" }),
  });
  expect(response.status === 403, `status ${response.status}`);
});

await check("Errors never show a stack trace or SQL", async () => {
  const response = await get("/api/v1/nope-smoke");
  const text = await response.text();
  expect(response.status === 404, `status ${response.status}`);
  expect(!/at \w+ \(|SELECT |sqlite|D1_ERROR|node_modules/i.test(text), "technical detail in an error");
});

await check("Sign-in links are not printed or exposed (mail mode is not console)", async () => {
  // A request without the bot-check token must be refused on a live site. On a copy in console mode it passes.
  const response = await get("/api/v1/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base.origin },
    body: JSON.stringify({ email: "smoke-check@example.com" }),
  });
  if (local) return "skipped on a local copy";
  expect(response.status !== 202, "the live site accepted a sign-in request with no bot-check token (is TURNSTILE_SECRET set?)");
});

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.note}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed (${base.origin})`);
process.exit(failed === 0 ? 0 : 1);
