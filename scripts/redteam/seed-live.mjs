// Seeds ONE throwaway account on your own local API (localhost only) and prints a cookie for the scanners.
// Usage: node scripts/redteam/seed-live.mjs [baseUrl] [logFile]
import { readFileSync } from "node:fs";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:8787");
if (!["127.0.0.1", "localhost"].includes(base.hostname)) { console.error("Localhost only."); process.exit(2); }
const log = process.argv[3] ?? ".e2e/api.log";
const origin = "http://localhost:4321";
const email = `scan${Date.now()}@example.com`;
const headers = { "content-type": "application/json", origin, "cf-connecting-ip": "10.77.0.1" };
const asked = await fetch(`${base.origin}/api/v1/auth/magic-link`, { method: "POST", headers, body: JSON.stringify({ email }) });
if (asked.status !== 202) throw new Error(`magic-link ${asked.status}`);
await new Promise((r) => setTimeout(r, 500));
const text = readFileSync(log, "utf8");
const link = [...text.matchAll(/(https?:\/\/[^\s"']*token=[A-Za-z0-9_-]+)/g)].at(-1)?.[1];
if (!link) throw new Error("no link in log");
const token = new URL(link).searchParams.get("token");
const cb = await fetch(`${base.origin}/api/v1/auth/callback?token=${token}`, { redirect: "manual", headers: { "cf-connecting-ip": "10.77.0.1" } });
const cookie = (cb.headers.get("set-cookie") ?? "").split(";")[0];
if (!cookie) throw new Error(`no cookie (${cb.status})`);
const call = (method, path, body) => fetch(base.origin + path, { method, headers: { ...headers, cookie }, body: JSON.stringify(body) });
console.error("profile", (await call("PATCH", "/api/v1/me", { username: "scanme", display_name: "Scan Me", bio: "Scanner target" })).status);
for (const l of [{ title: "Site", target: "https://example.com" }, { kind: "whatsapp", title: "Chat", target: "+2348012345678", message: "Hi" }]) console.error("link", (await call("POST", "/api/v1/links", l)).status);
console.log(cookie);
