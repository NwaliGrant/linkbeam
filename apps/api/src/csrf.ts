import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";
import { ApiError } from "./errors";
import { appUrl } from "./http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const forbidden = (): ApiError => new ApiError(403, "csrf_blocked", "This request was blocked for your safety.");

/**
 * Cross-site request protection for every state-changing request, in two layers:
 *  1. Fetch Metadata: a browser tells us whether the request came from our own site.
 *  2. Origin header: must equal the site's own origin. When it is missing, the browser must have
 *     said "same-origin"; a missing Origin with no browser proof is refused.
 * The session cookie is also SameSite=Lax and every body must be JSON, so a plain HTML form cannot send one.
 */
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const site = c.req.header("sec-fetch-site");
  if (site !== undefined && site !== "same-origin" && site !== "none") throw forbidden();

  const origin = c.req.header("origin");
  const expected = new URL(appUrl(c)).origin;
  if (origin !== undefined) {
    if (origin !== expected) throw forbidden();
  } else if (site !== "same-origin") {
    throw forbidden();
  }
  return next();
};
