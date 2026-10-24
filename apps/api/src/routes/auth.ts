import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { callbackQuerySchema, magicLinkRequestSchema, oauthCallbackQuerySchema } from "@linkbeam/shared";
import { randomId, sha256Hex } from "../crypto";
import type { AppEnv } from "../env";
import { appUrl, readJson, writeAudit } from "../http";
import { requireHuman } from "../human";
import { PROVIDERS, type Provider } from "../oauth";
import { hitDb, limitByIp } from "../ratelimit";
import { completeSignIn } from "../signin";
import { clearSessionCookie, requireSession } from "../sessions";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_COOKIE = "lb_oauth";

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export function authRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // Always answers the same way, whether or not the email has an account.
  routes.post("/magic-link", limitByIp("magicLinkIp"), async (c) => {
    const input = await readJson(c, magicLinkRequestSchema);
    await requireHuman(c, input.turnstile_token);
    const { email } = input;
    const now = c.get("now");

    // Per-address limit stops someone flooding one inbox. It answers 202 like a success, so it reveals nothing.
    const perEmail = await hitDb(c.env.DB, "magic-email", email, c.get("limits").magicLinkEmail, now);
    if (!perEmail.allowed) return c.json({ ok: true }, 202);

    const token = randomId(32);
    await c.env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?1, ?2, ?3)")
      .bind(await sha256Hex(token), email, now + MAGIC_LINK_TTL_SECONDS)
      .run();

    const link = `${appUrl(c)}/api/v1/auth/callback?token=${token}`;
    try {
      await c.get("mailer").sendMagicLink(email, link);
    } catch {
      // A failed send must look the same as a successful one, or it would reveal state.
    }
    return c.json({ ok: true }, 202);
  });

  routes.get("/callback", limitByIp("callbackIp"), async (c) => {
    const base = appUrl(c);
    const failure = c.redirect(`${base}/signin?error=invalid_link`, 302);
    const parsed = callbackQuerySchema.safeParse({ token: c.req.query("token") });
    if (!parsed.success) return failure;

    const now = c.get("now");
    // One statement both checks and consumes the token, so parallel requests cannot both win.
    const consumed = await c.env.DB.prepare(
      "UPDATE login_tokens SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1 RETURNING email",
    )
      .bind(now, await sha256Hex(parsed.data.token))
      .first<{ email: string }>();
    if (!consumed) return failure;

    return c.redirect(await completeSignIn(c, consumed.email, "magic_link"), 302);
  });

  // Google and GitHub sign-in (authorization code flow with PKCE where the provider supports it).
  routes.get("/:provider/start", limitByIp("oauthStartIp"), async (c) => {
    const provider = c.req.param("provider");
    const base = appUrl(c);
    if (!isProvider(provider) || !c.get("oauth").isConfigured(provider)) {
      return c.redirect(`${base}/signin?error=provider_unavailable`, 302);
    }
    const state = randomId(32);
    const verifier = randomId(48);
    await c.env.DB.prepare(
      "INSERT INTO oauth_states (state_hash, provider, code_verifier, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind(await sha256Hex(state), provider, verifier, c.get("now") + OAUTH_STATE_TTL_SECONDS)
      .run();
    // The same state is also kept in a cookie in this browser. A callback that did not start here is refused,
    // which stops an attacker from signing the victim in to the attacker's account.
    setCookie(c, OAUTH_COOKIE, state, {
      prefix: "host",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });
    return c.redirect(c.get("oauth").authorizationUrl(provider, state, verifier).toString(), 302);
  });

  routes.get("/:provider/callback", limitByIp("callbackIp"), async (c) => {
    const provider = c.req.param("provider");
    const base = appUrl(c);
    const failure = c.redirect(`${base}/signin?error=invalid_link`, 302);
    if (!isProvider(provider) || !c.get("oauth").isConfigured(provider)) return failure;

    const cookieState = getCookie(c, OAUTH_COOKIE, "host");
    deleteCookie(c, OAUTH_COOKIE, { prefix: "host", secure: true, path: "/" });
    const query = oauthCallbackQuerySchema.safeParse({ code: c.req.query("code"), state: c.req.query("state") });
    if (!query.success || !cookieState || cookieState !== query.data.state) return failure;

    const row = await c.env.DB.prepare(
      "DELETE FROM oauth_states WHERE state_hash = ?1 AND provider = ?2 AND expires_at > ?3 RETURNING code_verifier",
    )
      .bind(await sha256Hex(query.data.state), provider, c.get("now"))
      .first<{ code_verifier: string }>();
    if (!row) return failure;

    const identity = await c.get("oauth").identify(provider, query.data.code, row.code_verifier);
    if (!identity) return failure;
    return c.redirect(await completeSignIn(c, identity.email, provider), 302);
  });

  routes.post("/logout", requireSession, async (c) => {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(c.get("session").idHash).run();
    clearSessionCookie(c);
    await writeAudit(c, c.get("user").id, "logout");
    return c.body(null, 204);
  });

  // "Sign out everywhere": ends every session of this account, including this one.
  routes.post("/logout-all", requireSession, async (c) => {
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(c.get("user").id).run();
    clearSessionCookie(c);
    await writeAudit(c, c.get("user").id, "logout_all");
    return c.body(null, 204);
  });

  return routes;
}

