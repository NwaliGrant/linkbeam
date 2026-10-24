import type { Context } from "hono";
import { randomId } from "./crypto";
import type { AppEnv } from "./env";
import { appUrl, writeAudit } from "./http";
import { clientIp, hitDb } from "./ratelimit";
import { createSession, setSessionCookie } from "./sessions";

export type SignInMethod = "magic_link" | "google" | "github";

/**
 * The one place that finishes a sign-in, whatever the method. Returns where to send the browser.
 * A fresh session id is created every time, so nothing the visitor held before is ever reused.
 */
export async function completeSignIn(c: Context<AppEnv>, email: string, method: SignInMethod): Promise<string> {
  const base = appUrl(c);
  const failure = `${base}/signin?error=invalid_link`;
  const now = c.get("now");

  let user = await c.env.DB.prepare("SELECT id, is_banned FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string; is_banned: number }>();

  if (!user) {
    // Creating accounts is what a bot farm wants, so it has its own, tighter limit.
    const verdict = await hitDb(c.env.DB, "signup", clientIp(c), c.get("limits").signupIp, now);
    if (!verdict.allowed) return `${base}/signin?error=rate_limited`;
    await c.env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO NOTHING")
      .bind(randomId(12), email, now)
      .run();
    user = await c.env.DB.prepare("SELECT id, is_banned FROM users WHERE email = ?1")
      .bind(email)
      .first<{ id: string; is_banned: number }>();
  }
  if (!user || user.is_banned === 1) return failure;

  const session = await createSession(c.env.DB, user.id, now, c.req.header("user-agent") ?? "");
  setSessionCookie(c, session);
  await writeAudit(c, user.id, method === "magic_link" ? "login" : `login_${method}`);
  return `${base}/dashboard`;
}
