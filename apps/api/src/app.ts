import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps } from "./env";
import { ApiError, errorBody } from "./errors";
import { csrfProtection } from "./csrf";
import { mailerFor } from "./mailer";
import { oauthFor } from "./oauth";
import { createMemoryLimiter, DEFAULT_LIMITS, type Limits } from "./ratelimit";
import { turnstileFor } from "./turnstile";
import { authRoutes } from "./routes/auth";
import { linkRoutes } from "./routes/links";
import { meRoutes } from "./routes/me";
import { pageCsp, pageRoutes } from "./routes/page";
import { renderErrorPage } from "./publicPage";
import { publicRoutes } from "./routes/public";

const JSON_LIMIT_BYTES = 16 * 1024;
const AVATAR_LIMIT_BYTES = 1_200_000;

export function createApp(deps: Deps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const limits: Limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const trackLimit = createMemoryLimiter();

  // Registered first, so it runs last on the way out and can replace the default policy below.
  app.use("*", async (c, next) => {
    await next();
    const csp = c.get("csp");
    if (csp) c.res.headers.set("Content-Security-Policy", csp);
  });

  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );

  app.use("*", async (c, next) => {
    c.set("now", deps.now ? deps.now() : Math.floor(Date.now() / 1000));
    c.set("mailer", deps.mailer ?? mailerFor(c.env));
    c.set("turnstile", deps.turnstile ?? turnstileFor(c.env));
    c.set("oauth", deps.oauth ?? oauthFor(c.env));
    c.set("limits", limits);
    c.set("trackLimit", trackLimit);
    c.header("Cache-Control", "no-store");
    await next();
  });

  const tooLarge = (c: Parameters<Parameters<typeof app.use>[1]>[0]) =>
    c.json(errorBody("payload_too_large", "The request is too large."), 413);
  const smallBody = bodyLimit({ maxSize: JSON_LIMIT_BYTES, onError: tooLarge });
  const avatarBody = bodyLimit({ maxSize: AVATAR_LIMIT_BYTES, onError: tooLarge });
  app.use("*", (c, next) => (c.req.path === "/api/v1/me/avatar" ? avatarBody(c, next) : smallBody(c, next)));

  const api = new Hono<AppEnv>();
  api.use("*", csrfProtection);
  api.get("/health", (c) => c.json({ ok: true, service: "linkbeam-api" }));
  api.route("/auth", authRoutes());
  api.route("/me", meRoutes());
  api.route("/links", linkRoutes());
  api.route("/", publicRoutes());
  app.route("/api/v1", api);
  app.route("/", pageRoutes());

  app.notFound((c) => c.json(errorBody("not_found", "This address does not exist."), 404));

  app.onError(async (error, c) => {
    if (error instanceof ApiError) return c.json(errorBody(error.code, error.message), error.status, error.headers);
    // A visitor opening a shared page gets a friendly page, not JSON. Never echo the underlying error either way:
    // it could contain SQL or internal details.
    if (c.req.method === "GET" && c.req.path.startsWith("/u/")) {
      const html = renderErrorPage();
      c.set("csp", await pageCsp(html));
      c.header("Cache-Control", "no-store");
      c.header("X-Robots-Tag", "noindex");
      return c.html(html, 500);
    }
    return c.json(errorBody("server_error", "Something went wrong. Please try again."), 500);
  });

  return app;
}
