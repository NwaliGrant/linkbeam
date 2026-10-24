// Red-team round 1: auth bypass (2), user enumeration (3) and CSRF (7), against YOUR OWN local API only.
// Usage:   node scripts/redteam/round1.mjs [baseUrl]      (default http://127.0.0.1:8787)
// Setup:   run the API with `pnpm dev:api`, apply migrations, and seed users (see docs/SECURITY_REPORT.md).
// It refuses to run against anything that is not localhost, as the rules of engagement require.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:8787");
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(base.hostname)) {
  console.error(`Refusing to attack ${base.hostname}. Red-team scripts run against localhost only.`);
  process.exit(2);
}
const origin = base.origin;
let ipCounter = 1;
const freshIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
const results = [];
const record = (id, attack, pass, detail) => {
  results.push({ id, attack, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  #${id}  ${attack}${detail ? `  (${detail})` : ""}`);
};

const post = (path, body, headers = {}) =>
  fetch(origin + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin, "cf-connecting-ip": freshIp(), ...headers }, body: JSON.stringify(body) });

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p90 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];

// ---- Checklist 7: CSRF --------------------------------------------------------------------------------------
{
  const evil = await post("/api/v1/auth/magic-link", { email: "csrf@example.com" }, { origin: "https://evil.example" });
  record(7, "cross-site Origin on a state-changing request", evil.status === 403, `status ${evil.status}`);
  const none = await fetch(origin + "/api/v1/auth/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  record(7, "no Origin and no Fetch Metadata", none.status === 403, `status ${none.status}`);
  const form = await fetch(origin + "/api/v1/me", { method: "DELETE", headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: "x=1" });
  record(7, "cross-site form-style DELETE /me", form.status === 403, `status ${form.status}`);
}

// ---- Checklist 2: token abuse -------------------------------------------------------------------------------
{
  const ip = "10.99.99.99";
  const statuses = [];
  for (let i = 0; i < 45; i++) {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const r = await fetch(`${origin}/api/v1/auth/callback?token=${token}`, { redirect: "manual", headers: { "cf-connecting-ip": ip } });
    statuses.push(r.status);
  }
  const limited = statuses.filter((s) => s === 429).length;
  const loggedIn = statuses.filter((s) => s === 302).length;
  record(2, "brute-force 45 random tokens from one IP", limited >= 10 && loggedIn <= 30, `${loggedIn} redirects, ${limited} x 429`);
  const locations = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${origin}/api/v1/auth/callback?token=${"Z".repeat(43)}`, { redirect: "manual", headers: { "cf-connecting-ip": freshIp() } });
    locations.add(r.headers.get("location"));
    if (r.headers.get("set-cookie")) locations.add("COOKIE SET");
  }
  record(2, "a wrong token never sets a cookie and always goes to the same place", locations.size === 1, [...locations].join(" | "));
}

// ---- Checklist 3: enumeration, responses and timing ----------------------------------------------------------
{
  const N = Number(process.env.SAMPLES ?? 40);
  const timeOne = async (email) => {
    const t0 = performance.now();
    const r = await post("/api/v1/auth/magic-link", { email });
    const ms = performance.now() - t0;
    return { ms, status: r.status, text: await r.text() };
  };
  await timeOne("warmup@example.com");
  const existing = [];
  const unknown = [];
  // Interleave the two kinds so slow moments on the machine hit both equally.
  for (let i = 0; i < N; i++) {
    existing.push(await timeOne(`seed${i % 20}@example.com`));
    unknown.push(await timeOne(`nobody-${Date.now()}-${i}@example.com`));
  }
  const bodies = new Set([...existing, ...unknown].map((x) => `${x.status} ${x.text}`));
  record(3, "magic-link response bytes, existing vs unknown email", bodies.size === 1, [...bodies][0]);
  const me = median(existing.map((x) => x.ms));
  const mu = median(unknown.map((x) => x.ms));
  const ratio = Math.max(me, mu) / Math.min(me, mu);
  console.log(`      timing over ${N} pairs: existing median ${me.toFixed(1)} ms (p90 ${p90(existing.map((x) => x.ms)).toFixed(1)}), unknown median ${mu.toFixed(1)} ms (p90 ${p90(unknown.map((x) => x.ms)).toFixed(1)}), ratio ${ratio.toFixed(2)}`);
  record(3, "magic-link timing, existing vs unknown email", ratio < 1.5 && Math.abs(me - mu) < 15, `median gap ${(me - mu).toFixed(1)} ms`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} defences held.`);
process.exit(failed.length === 0 ? 0 : 1);
