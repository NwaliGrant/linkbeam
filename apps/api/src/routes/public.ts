import { Hono } from "hono";
import { checkUsername, reportSchema, trackSchema, type LinkKind } from "@linkbeam/shared";
import { randomId } from "../crypto";
import type { AppEnv } from "../env";
import { notFound } from "../errors";
import { requireHuman } from "../human";
import { readJson } from "../http";
import { clientIp, limitByIp, tooManyRequests } from "../ratelimit";
import { avatarUrl } from "./me";

const SECONDS_PER_DAY = 86_400;

export interface PublicUser {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_key: string | null;
  theme: string;
  accent: string | null;
  button_shape: string;
  font_pair: string;
  bg_style: string;
  show_badge: number;
}

export function lookupName(raw: string): string | null {
  const checked = checkUsername(raw);
  return checked.ok ? checked.username : null;
}

export async function findPublicUser(db: D1Database, name: string): Promise<PublicUser | null> {
  return db
    .prepare(
      "SELECT id, username, display_name, bio, avatar_key, theme, accent, button_shape, font_pair, bg_style, show_badge FROM users WHERE username = ?1 AND is_banned = 0",
    )
    .bind(name)
    .first<PublicUser>();
}

export interface PublicLink {
  id: string;
  kind: LinkKind;
  title: string;
  target: string;
  message: string | null;
}

/** Links that are switched on and inside their schedule, in the owner's order. */
export async function findPublicLinks(db: D1Database, userId: string, now: number): Promise<PublicLink[]> {
  const rows = await db
    .prepare(
      `SELECT id, kind, title, target, message FROM links
        WHERE user_id = ?1 AND enabled = 1
          AND (starts_at IS NULL OR starts_at <= ?2) AND (ends_at IS NULL OR ends_at > ?2)
        ORDER BY position`,
    )
    .bind(userId, now)
    .all<PublicLink>();
  return rows.results;
}

export function publicRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/u/:username", async (c) => {
    const name = lookupName(c.req.param("username"));
    const user = name ? await findPublicUser(c.env.DB, name) : null;
    if (!user) throw notFound("This page does not exist.");

    const links = await findPublicLinks(c.env.DB, user.id, c.get("now"));

    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      username: user.username,
      display_name: user.display_name,
      bio: user.bio,
      avatar_url: avatarUrl(user.avatar_key),
      theme: user.theme,
      accent: user.accent,
      button_shape: user.button_shape,
      font_pair: user.font_pair,
      bg_style: user.bg_style,
      show_badge: user.show_badge === 1,
      links,
    });
  });

  routes.get("/avatar/:key", async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT a.content_type, a.data FROM avatars a JOIN users u ON u.id = a.user_id
        WHERE a.key = ?1 AND u.is_banned = 0`,
    )
      .bind(c.req.param("key").slice(0, 64))
      .first<{ content_type: string; data: ArrayBuffer | number[] }>();
    if (!row) throw notFound("This photo does not exist.");

    // Keeps the sandbox: even if an uploaded file were not really an image, it could not run anything.
    c.set("csp", "default-src 'none'; sandbox");
    const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
    return c.body(bytes, 200, {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
  
      "X-Content-Type-Options": "nosniff",
    });
  });

  // Page views and link clicks. Always 204 for well-formed requests, and it stores only counts.
  routes.post("/track", async (c) => {
    const verdict = c.get("trackLimit")(clientIp(c), c.get("limits").track, c.get("now"));
    if (!verdict.allowed) throw tooManyRequests(verdict.retryAfter);
    const input = await readJson(c, trackSchema);
    const name = lookupName(input.page);
    if (!name) return c.body(null, 204);

    const found = await c.env.DB.prepare(
      `SELECT u.id AS user_id, l.id AS link_id FROM users u
         LEFT JOIN links l ON l.user_id = u.id AND l.id = ?2 AND l.enabled = 1
        WHERE u.username = ?1 AND u.is_banned = 0`,
    )
      .bind(name, input.link ?? null)
      .first<{ user_id: string; link_id: string | null }>();
    if (!found) return c.body(null, 204);

    const day = Math.floor(c.get("now") / SECONDS_PER_DAY);
    if (input.link === undefined) {
      await c.env.DB.prepare(
        `INSERT INTO daily_stats (day, user_id, link_id, views, clicks) VALUES (?1, ?2, NULL, 1, 0)
         ON CONFLICT(day, user_id) WHERE link_id IS NULL DO UPDATE SET views = views + 1`,
      )
        .bind(day, found.user_id)
        .run();
    } else if (found.link_id !== null) {
      await c.env.DB.prepare(
        `INSERT INTO daily_stats (day, user_id, link_id, views, clicks) VALUES (?1, ?2, ?3, 0, 1)
         ON CONFLICT(day, user_id, link_id) WHERE link_id IS NOT NULL DO UPDATE SET clicks = clicks + 1`,
      )
        .bind(day, found.user_id, found.link_id)
        .run();
    }
    return c.body(null, 204);
  });

  // Same answer whether or not the page exists, so reports cannot be used to probe usernames.
  routes.post("/report", limitByIp("report"), async (c) => {
    const input = await readJson(c, reportSchema);
    await requireHuman(c, input.turnstile_token);
    const name = lookupName(input.page);
    const user = name ? await findPublicUser(c.env.DB, name) : null;
    if (user) {
      await c.env.DB.prepare("INSERT INTO reports (id, user_id, reason, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(randomId(12), user.id, input.reason, c.get("now"))
        .run();
    }
    return c.json({ ok: true }, 202);
  });

  return routes;
}
