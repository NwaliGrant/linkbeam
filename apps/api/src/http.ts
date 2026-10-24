import type { Context } from "hono";
import type { z } from "zod";
import { sha256Hex } from "./crypto";
import { ApiError } from "./errors";
import type { AppEnv } from "./env";

export async function readJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send the request as JSON.");
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  return validate(schema, body);
}

export function validate<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new ApiError(400, "invalid_input", `${field}${issue?.message ?? "Invalid request."}`);
  }
  return result.data;
}

export function appUrl(c: Context<AppEnv>): string {
  const value = c.env.APP_URL;
  if (!value) throw new ApiError(500, "server_error", "Something went wrong. Please try again.");
  return value.replace(/\/+$/, "");
}

export async function writeAudit(c: Context<AppEnv>, userId: string | null, action: string): Promise<void> {
  const secret = c.env.IP_HASH_SECRET;
  const ip = c.req.header("cf-connecting-ip");
  let ipHash: string | null = null;
  if (secret && ip) {
    const day = Math.floor(c.get("now") / 86_400);
    ipHash = await sha256Hex(`${secret}:${day}:${ip}`);
  }
  await c.env.DB.prepare("INSERT INTO audit_log (user_id, action, at, ip_hash) VALUES (?1, ?2, ?3, ?4)")
    .bind(userId, action, c.get("now"), ipHash)
    .run();
}
