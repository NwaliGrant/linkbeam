import { Hono } from "hono";
import { profilePatchSchema, statsQuerySchema } from "@linkbeam/shared";
import { randomId } from "../crypto";
import type { AppEnv, SessionUser } from "../env";
import { ApiError, unauthorized } from "../errors";
import { readJson, validate, writeAudit } from "../http";
import { MAX_AVATAR_BYTES, sanitizeImage } from "../image";
import { FRESH_SESSION_SECONDS, clearSessionCookie, requireSession } from "../sessions";

export const USERNAME_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const SECONDS_PER_DAY = 86_400;

export function avatarUrl(key: string | null): string | null {
  return key ? `/api/v1/avatar/${key}` : null;
}

function profileOf(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
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
    created_at: user.created_at,
  };
}

const GET_USER_SQL =
  "SELECT id, email, username, username_changed_at, display_name, bio, avatar_key, theme, accent, button_shape, font_pair, bg_style, show_badge, created_at FROM users WHERE id = ?1";

function requireFreshSession(createdAt: number, now: number): void {
  if (now - createdAt > FRESH_SESSION_SECONDS) {
    throw new ApiError(401, "reauth_required", "Please sign in again to do this.");
  }
}

function dateOfDay(day: number): string {
  return new Date(day * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);
}

export function meRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", requireSession, (c) => c.json(profileOf(c.get("user"))));

  routes.patch("/", requireSession, async (c) => {
    const user = c.get("user");
    const input = await readJson(c, profilePatchSchema);
    const now = c.get("now");

    let newUsername: string | null = null;
    let changedAt: number | null = null;
    if (input.username !== undefined && input.username !== user.username) {
      if (user.username !== null) {
        if (user.username_changed_at !== null && now - user.username_changed_at < USERNAME_COOLDOWN_SECONDS) {
          throw new ApiError(429, "username_cooldown", "You can change your username once every 7 days.");
        }
        changedAt = now;
      }
      newUsername = input.username;
    }

    let result: D1Result;
    try {
      result = await c.env.DB.prepare(
        `UPDATE users SET
           username = COALESCE(?1, username),
           username_changed_at = COALESCE(?2, username_changed_at),
           display_name = COALESCE(?3, display_name),
           bio = COALESCE(?4, bio),
           theme = COALESCE(?5, theme),
           accent = CASE WHEN ?6 = 1 THEN ?7 ELSE accent END,
           button_shape = COALESCE(?9, button_shape),
           font_pair = COALESCE(?10, font_pair),
           bg_style = COALESCE(?11, bg_style),
           show_badge = COALESCE(?12, show_badge)
         WHERE id = ?8 AND username IS ?13 AND username_changed_at IS ?14`,
      )
        .bind(
          newUsername,
          changedAt,
          input.display_name ?? null,
          input.bio ?? null,
          input.theme ?? null,
          input.accent !== undefined ? 1 : 0,
          input.accent ?? null,
          user.id,
          input.button_shape ?? null,
          input.font_pair ?? null,
          input.bg_style ?? null,
          input.show_badge === undefined ? null : input.show_badge ? 1 : 0,
          user.username,
          user.username_changed_at,
        )
        .run();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ApiError(409, "username_taken", "This username is taken. Please choose another.");
      }
      throw error;
    }
    // The username and its cooldown time are part of the condition above. If another request changed them
    // first (50 parallel requests, two tabs), this one changed nothing, so the 7-day limit cannot be raced.
    if (result.meta.changes === 0) {
      const now2 = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?1").bind(user.id).first();
      if (!now2) throw unauthorized();
      throw new ApiError(409, "profile_changed", "Your profile was changed by another request. Please try again.");
    }

    const updated = await c.env.DB.prepare(GET_USER_SQL)
      .bind(user.id)
      .first<SessionUser>();
    if (!updated) throw unauthorized();
    return c.json(profileOf(updated));
  });

  routes.post("/avatar", requireSession, async (c) => {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_AVATAR_BYTES + 4096) throw new ApiError(413, "payload_too_large", "The photo is too large. Maximum is 1 MB.");
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new ApiError(415, "unsupported_media_type", "Upload the photo as a form file.");
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new ApiError(400, "invalid_input", "The upload could not be read.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "invalid_input", "file: Choose a photo to upload.");
    if (file.size > MAX_AVATAR_BYTES) throw new ApiError(413, "payload_too_large", "The photo is too large. Maximum is 1 MB.");

    const clean = sanitizeImage(new Uint8Array(await file.arrayBuffer()));
    if (!clean) throw new ApiError(400, "invalid_image", "Use a JPEG, PNG or WebP photo up to 4096 pixels wide and tall.");

    const user = c.get("user");
    const key = randomId(16);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM avatars WHERE user_id = ?1").bind(user.id),
      c.env.DB.prepare("INSERT INTO avatars (key, user_id, content_type, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
        key,
        user.id,
        clean.contentType,
        clean.bytes,
        c.get("now"),
      ),
      c.env.DB.prepare("UPDATE users SET avatar_key = ?1 WHERE id = ?2").bind(key, user.id),
    ]);
    return c.json({ avatar_url: avatarUrl(key) }, 201);
  });

  routes.get("/stats", requireSession, async (c) => {
    const { days } = validate(statsQuerySchema, { days: c.req.query("days") });
    const user = c.get("user");
    const today = Math.floor(c.get("now") / SECONDS_PER_DAY);
    const from = today - days + 1;

    const perDay = await c.env.DB.prepare(
      "SELECT day, SUM(views) AS views, SUM(clicks) AS clicks FROM daily_stats WHERE user_id = ?1 AND day >= ?2 GROUP BY day",
    )
      .bind(user.id, from)
      .all<{ day: number; views: number; clicks: number }>();
    const top = await c.env.DB.prepare(
      `SELECT l.id, l.title, SUM(s.clicks) AS clicks
         FROM daily_stats s JOIN links l ON l.id = s.link_id
        WHERE s.user_id = ?1 AND s.day >= ?2
        GROUP BY l.id, l.title ORDER BY clicks DESC, l.title ASC LIMIT 10`,
    )
      .bind(user.id, from)
      .all<{ id: string; title: string; clicks: number }>();

    const byDay = new Map(perDay.results.map((row) => [row.day, row]));
    const daily = Array.from({ length: days }, (_, index) => {
      const day = from + index;
      const row = byDay.get(day);
      return { date: dateOfDay(day), views: row?.views ?? 0, clicks: row?.clicks ?? 0 };
    });
    const totals = daily.reduce((sum, row) => ({ views: sum.views + row.views, clicks: sum.clicks + row.clicks }), {
      views: 0,
      clicks: 0,
    });
    return c.json({ days, totals, daily, top_links: top.results });
  });

  routes.get("/export", requireSession, async (c) => {
    requireFreshSession(c.get("session").createdAt, c.get("now"));
    const user = c.get("user");
    const links = await c.env.DB.prepare(
      "SELECT id, kind, title, target, message, position, enabled, starts_at, ends_at FROM links WHERE user_id = ?1 ORDER BY position",
    )
      .bind(user.id)
      .all();
    const stats = await c.env.DB.prepare("SELECT day, link_id, views, clicks FROM daily_stats WHERE user_id = ?1 ORDER BY day")
      .bind(user.id)
      .all();
    const avatar = await c.env.DB.prepare("SELECT content_type, data FROM avatars WHERE user_id = ?1")
      .bind(user.id)
      .first<{ content_type: string; data: ArrayBuffer | number[] }>();

    await writeAudit(c, user.id, "export");
    c.header("Content-Disposition", 'attachment; filename="linkbeam-export.json"');
    return c.json({
      exported_at: c.get("now"),
      profile: profileOf(user),
      links: links.results,
      daily_stats: stats.results,
      avatar: avatar ? { content_type: avatar.content_type, base64: toBase64(avatar.data) } : null,
    });
  });

  routes.delete("/", requireSession, async (c) => {
    requireFreshSession(c.get("session").createdAt, c.get("now"));
    const user = c.get("user");
    await writeAudit(c, user.id, "delete");
    // Foreign keys cascade: sessions, links, stats, reports and the avatar go with the user.
    // Sign-in tokens hold the email address and are not tied to the user row, so they are removed by address.
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM login_tokens WHERE email = ?1").bind(user.email),
      c.env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(user.id),
    ]);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  return routes;
}

function toBase64(data: ArrayBuffer | number[]): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
