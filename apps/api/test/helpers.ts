import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { createApp } from "../src/app";
import { randomId } from "../src/crypto";
import type { Bindings, Deps, Mailer } from "../src/env";
import { createSession } from "../src/sessions";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "..", "..", "migrations");

export const START_TIME = 1_800_000_000;

export interface SentMail {
  email: string;
  link: string;
}

export interface TestUser {
  id: string;
  email: string;
  username: string | null;
  cookie: string;
}

export interface Harness {
  db: D1Database;
  mail: SentMail[];
  clock: { now: number };
  /** Sends a request the way our own site's browser code would: with a same-origin Origin header. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Sends exactly what it is given, with no default headers. */
  rawRequest(path: string, init?: RequestInit, env?: Partial<Bindings>): Promise<Response>;
  /** Creates a user row and a signed-in session directly in the database. */
  createUser(options?: { email?: string; username?: string | null; createdAt?: number }): Promise<TestUser>;
  /** Wipes all rows so every test starts clean. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

async function applyMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const statement of sql.split(/;\s*\n/)) {
      if (statement.trim().length > 0) await db.prepare(statement).run();
    }
  }
}

export interface HarnessOptions {
  mailer?: Mailer;
  turnstile?: Deps["turnstile"];
  oauth?: Deps["oauth"];
  limits?: Deps["limits"];
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "linkbeam-test" },
  });
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  await applyMigrations(db);

  const mail: SentMail[] = [];
  const mailer: Mailer = {
    async sendMagicLink(email, link) {
      mail.push({ email, link });
    },
  };
  const clock = { now: START_TIME };
  const app = createApp({
    mailer: options.mailer ?? mailer,
    now: () => clock.now,
    turnstile: options.turnstile ?? (async (token) => token !== "bad-token"),
    ...(options.oauth ? { oauth: options.oauth } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  });
  const env: Bindings = { DB: db, APP_URL: "https://linkbeam.test", IP_HASH_SECRET: "test-secret" };

  return {
    db,
    mail,
    clock,
    request(path, init) {
      const headers = new Headers(init?.headers);
      if (!headers.has("origin")) headers.set("origin", "https://linkbeam.test");
      return Promise.resolve(app.fetch(new Request(`https://linkbeam.test${path}`, { ...init, headers }), env));
    },
    rawRequest: (path, init, extraEnv) =>
      Promise.resolve(app.fetch(new Request(`https://linkbeam.test${path}`, init), { ...env, ...extraEnv })),
    async createUser(options = {}) {
      const id = randomId(12);
      const email = options.email ?? `${randomId(6).toLowerCase()}@example.com`;
      const username = options.username === undefined ? null : options.username;
      await db
        .prepare("INSERT INTO users (id, email, username, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(id, email, username, options.createdAt ?? clock.now)
        .run();
      const token = await createSession(db, id, clock.now, "test-agent");
      return { id, email, username, cookie: `__Host-lb_session=${token}` };
    },
    async reset() {
      mail.length = 0;
      clock.now = START_TIME;
      await db.batch([
        db.prepare("DELETE FROM users"),
        db.prepare("DELETE FROM login_tokens"),
        db.prepare("DELETE FROM audit_log"),
        db.prepare("DELETE FROM rate_limits"),
        db.prepare("DELETE FROM oauth_states"),
      ]);
    },
    async dispose() {
      await miniflare.dispose();
    },
  };
}

export function json(body: unknown, cookie?: string, method = "POST"): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return { method, headers, body: JSON.stringify(body) };
}

export function authed(cookie: string, method = "GET"): RequestInit {
  return { method, headers: { cookie } };
}

export async function addLink(
  h: Harness,
  user: TestUser,
  body: Record<string, unknown> = {},
): Promise<{ id: string; position: number; title: string }> {
  const response = await h.request("/api/v1/links", json({ title: "Link", target: "https://example.com", ...body }, user.cookie));
  if (response.status !== 201) throw new Error(`addLink failed with ${response.status}`);
  return (await response.json()) as { id: string; position: number; title: string };
}

export async function rowCount(h: Harness, table: string, where = "1 = 1"): Promise<number> {
  // Test-only helper. Table and condition are literals written in the tests, never user input.
  const row = await h.db.prepare(["SELECT COUNT(*) AS n FROM", table, "WHERE", where].join(" ")).first<{ n: number }>();
  return row?.n ?? -1;
}
