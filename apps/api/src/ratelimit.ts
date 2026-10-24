import type { Context, MiddlewareHandler } from "hono";
import { sha256Hex } from "./crypto";
import type { AppEnv } from "./env";
import { ApiError } from "./errors";

export interface Rule {
  limit: number;
  windowSeconds: number;
}

/** Fixed-window limits. Every value is a decision recorded in docs/DECISIONS.md (D-025). */
export const DEFAULT_LIMITS = {
  magicLinkIp: { limit: 5, windowSeconds: 3600 },
  magicLinkEmail: { limit: 3, windowSeconds: 3600 },
  report: { limit: 5, windowSeconds: 3600 },
  signupIp: { limit: 10, windowSeconds: 86_400 },
  callbackIp: { limit: 30, windowSeconds: 600 },
  oauthStartIp: { limit: 20, windowSeconds: 600 },
  track: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, Rule>;

export type LimitName = keyof typeof DEFAULT_LIMITS;
export type Limits = Record<LimitName, Rule>;

export interface Verdict {
  allowed: boolean;
  retryAfter: number;
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

/** Counts a hit in D1. One atomic statement, so parallel requests cannot slip past the limit. */
export async function hitDb(db: D1Database, name: string, id: string, rule: Rule, now: number): Promise<Verdict> {
  const window = Math.floor(now / rule.windowSeconds);
  const resetAt = (window + 1) * rule.windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window, count, expires_at) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(`${name}:${await sha256Hex(id)}`, window, resetAt)
    .first<{ count: number }>();
  const count = row?.count ?? Number.MAX_SAFE_INTEGER;
  return { allowed: count <= rule.limit, retryAfter: Math.max(1, resetAt - now) };
}

export function tooManyRequests(retryAfter: number): ApiError {
  return new ApiError(429, "rate_limited", "Too many requests. Please wait a little and try again.", {
    "Retry-After": String(retryAfter),
  });
}

/** Per-IP limit backed by D1. Shared by every Worker instance. */
export function limitByIp(name: LimitName): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const verdict = await hitDb(c.env.DB, name, clientIp(c), c.get("limits")[name], c.get("now"));
    if (!verdict.allowed) throw tooManyRequests(verdict.retryAfter);
    await next();
  };
}

/**
 * Best-effort limiter that lives in one Worker instance's memory. Used only for /track, where a D1
 * write per request would use up the free daily write budget. It slows a script down but is not
 * a hard guarantee, which D-025 states plainly.
 */
export function createMemoryLimiter(): (id: string, rule: Rule, now: number) => Verdict {
  const counters = new Map<string, { window: number; count: number }>();
  return (id, rule, now) => {
    const window = Math.floor(now / rule.windowSeconds);
    const resetAt = (window + 1) * rule.windowSeconds;
    if (counters.size > 5000) {
      for (const [key, value] of counters) if (value.window < window) counters.delete(key);
      if (counters.size > 5000) counters.clear();
    }
    const current = counters.get(id);
    const count = current && current.window === window ? current.count + 1 : 1;
    counters.set(id, { window, count });
    return { allowed: count <= rule.limit, retryAfter: Math.max(1, resetAt - now) };
  };
}
