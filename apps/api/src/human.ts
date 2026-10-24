import type { Context } from "hono";
import type { AppEnv } from "./env";
import { ApiError } from "./errors";

/** Throws unless the visitor passed the Turnstile bot check. */
export async function requireHuman(c: Context<AppEnv>, token: string | undefined): Promise<void> {
  const ip = c.req.header("cf-connecting-ip") ?? null;
  const ok = await c.get("turnstile")(token, ip);
  if (!ok) throw new ApiError(400, "turnstile_failed", "We could not confirm you are a person. Please try again.");
}
