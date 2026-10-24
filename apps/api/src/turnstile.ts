import type { Bindings } from "./env";

/** Returns true when the visitor passed the Cloudflare Turnstile check. */
export type TurnstileVerifier = (token: string | undefined, ip: string | null) => Promise<boolean>;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Fails closed. With no secret configured the check passes only in local development (MAIL_MODE=console),
 * so forgetting to set the secret in production blocks sign-ups instead of silently disabling the check.
 */
export function turnstileFor(env: Bindings): TurnstileVerifier {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return async () => env.MAIL_MODE === "console";
  return async (token, ip) => {
    if (!token || token.length > 2048) return false;
    try {
      const form = new FormData();
      form.set("secret", secret);
      form.set("response", token);
      if (ip) form.set("remoteip", ip);
      const response = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
      if (!response.ok) return false;
      const result = (await response.json()) as { success?: unknown };
      return result.success === true;
    } catch {
      return false;
    }
  };
}
