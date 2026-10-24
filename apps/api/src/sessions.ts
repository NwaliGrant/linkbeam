import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomId, sha256Hex } from "./crypto";
import type { AppEnv, SessionUser } from "./env";
import { unauthorized } from "./errors";

/** Cookie name on the wire is "__Host-lb_session" (Hono adds the prefix). */
export const SESSION_COOKIE = "lb_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Export and account deletion need a sign-in this recent. */
export const FRESH_SESSION_SECONDS = 10 * 60;
/** A session unused for this long ends, even if its 30 days are not over. */
export const SESSION_IDLE_SECONDS = 14 * 24 * 60 * 60;
/** last_seen_at is refreshed at most this often, to save D1 writes. */
const TOUCH_INTERVAL_SECONDS = 60 * 60;

export async function createSession(db: D1Database, userId: string, now: number, userAgent: string): Promise<string> {
  const token = randomId(32);
  await db
    .prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at, last_seen_at, user_agent_hash) VALUES (?1, ?2, ?3, ?4, ?4, ?5)")
    .bind(await sha256Hex(token), userId, now + SESSION_TTL_SECONDS, now, await sha256Hex(userAgent))
    .run();
  return token;
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { prefix: "host", secure: true, path: "/" });
}

interface SessionRow extends SessionUser {
  session_created_at: number;
  last_seen_at: number;
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE, "host");
  if (!token || token.length > 200) throw unauthorized();

  const idHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.username_changed_at, u.display_name, u.bio, u.avatar_key,
            u.theme, u.accent, u.button_shape, u.font_pair, u.bg_style, u.show_badge, u.created_at, s.created_at AS session_created_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ?1 AND s.expires_at > ?2 AND s.last_seen_at > ?3 AND u.is_banned = 0`,
  )
    .bind(idHash, c.get("now"), c.get("now") - SESSION_IDLE_SECONDS)
    .first<SessionRow>();
  if (!row) throw unauthorized();

  const { session_created_at: createdAt, last_seen_at: lastSeen, ...user } = row;
  if (c.get("now") - lastSeen >= TOUCH_INTERVAL_SECONDS) {
    await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE id_hash = ?2").bind(c.get("now"), idHash).run();
  }
  c.set("user", user);
  c.set("session", { idHash, createdAt });
  await next();
};
