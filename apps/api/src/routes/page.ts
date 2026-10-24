import { Hono } from "hono";
import type { AppEnv } from "../env";
import { sha256Hex } from "../crypto";
import { appUrl } from "../http";
import { BEACON_SCRIPT, renderNotFoundPage, renderPublicPage, type PublicPageData } from "../publicPage";
import { avatarUrl } from "./me";
import { findPublicLinks, findPublicUser, lookupName } from "./public";
import type { LinkKind, ThemeId, BgStyle, ButtonShape, FontPair } from "@linkbeam/shared";

// Shared caches may keep a page for a minute. A browser always checks (a cheap 304 reply through the ETag),
// so a person who just edited their page sees the change at once when they open it.
const PAGE_CACHE = "public, max-age=0, s-maxage=60";

async function sha256Base64(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...digest));
}

let scriptHash: Promise<string> | null = null;
/**
 * The page may run exactly one script (ours) and use exactly the style blocks it was sent with. Each is allowed by
 * its hash, so any other script or style, even an injected one, is blocked by the browser. There is no 'unsafe-inline'.
 */
export async function pageCsp(html: string): Promise<string> {
  scriptHash ??= sha256Base64(BEACON_SCRIPT);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "");
  const hashes = await Promise.all(styles.map(async (css) => `'sha256-${await sha256Base64(css)}'`));
  return (
    `default-src 'none'; script-src 'sha256-${await scriptHash}'; style-src ${hashes.join(" ") || "'none'"}; img-src 'self'; font-src 'self'; ` +
    `connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  );
}

/** Pages people share. They are plain HTML made on the server, so they show fast on slow phones. */
export function pageRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/u/:username", async (c) => {
    const raw = c.req.param("username");
    const name = lookupName(raw);

    if (name !== null && raw !== name) return c.redirect(`/u/${name}`, 301);

    const user = name ? await findPublicUser(c.env.DB, name) : null;
    if (!user) {
      c.header("Cache-Control", "public, max-age=30");
      c.header("X-Robots-Tag", "noindex");
      const missing = renderNotFoundPage();
      c.set("csp", await pageCsp(missing));
      return c.html(missing, 404);
    }

    const links = await findPublicLinks(c.env.DB, user.id, c.get("now"));
    const data: PublicPageData = {
      username: user.username,
      display_name: user.display_name,
      bio: user.bio,
      avatar_url: avatarUrl(user.avatar_key),
      theme: user.theme as ThemeId,
      accent: user.accent,
      button_shape: user.button_shape as ButtonShape,
      font_pair: user.font_pair as FontPair,
      bg_style: user.bg_style as BgStyle,
      show_badge: user.show_badge === 1,
      links: links.map((link) => ({ ...link, kind: link.kind as LinkKind })),
    };
    const html = renderPublicPage(data, { origin: appUrl(c) });
    const etag = `"${(await sha256Hex(html)).slice(0, 32)}"`;

    c.header("Cache-Control", PAGE_CACHE);
    c.header("ETag", etag);
    c.set("csp", await pageCsp(html));
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    return c.html(html);
  });

  return routes;
}
