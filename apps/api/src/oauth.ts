import { decodeIdToken, GitHub, Google } from "arctic";
import { normalizeEmail } from "@linkbeam/shared";
import type { Bindings } from "./env";

export type Provider = "google" | "github";
export const PROVIDERS: readonly Provider[] = ["google", "github"];

export interface OAuthIdentity {
  /** Normalised email that the provider says the person has verified. */
  email: string;
}

export interface OAuthClient {
  isConfigured(provider: Provider): boolean;
  authorizationUrl(provider: Provider, state: string, codeVerifier: string): URL;
  /** Returns the verified email, or null when the exchange fails or the email is not verified. */
  identify(provider: Provider, code: string, codeVerifier: string): Promise<OAuthIdentity | null>;
}

function redirectUri(env: Bindings, provider: Provider): string {
  return `${env.APP_URL.replace(/\/+$/, "")}/api/v1/auth/${provider}/callback`;
}

/**
 * Only an email the provider marks as verified is accepted. Without that check, someone could register at
 * the provider with another person's address and sign in to that person's Linkbeam account.
 */
async function githubVerifiedEmail(accessToken: string): Promise<string | null> {
  const response = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "linkbeam", Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return null;
  const list = (await response.json()) as unknown;
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as { email?: unknown; primary?: unknown; verified?: unknown };
    if (item.primary === true && item.verified === true && typeof item.email === "string") return normalizeEmail(item.email);
  }
  return null;
}

export function oauthFor(env: Bindings): OAuthClient {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri(env, "google"))
      : null;
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? new GitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, redirectUri(env, "github"))
      : null;

  return {
    isConfigured: (provider) => (provider === "google" ? google !== null : github !== null),
    authorizationUrl(provider, state, codeVerifier) {
      if (provider === "google" && google) return google.createAuthorizationURL(state, codeVerifier, ["openid", "email"]);
      if (provider === "github" && github) return github.createAuthorizationURL(state, ["user:email"]);
      throw new Error("provider not configured");
    },
    async identify(provider, code, codeVerifier) {
      try {
        if (provider === "google" && google) {
          const tokens = await google.validateAuthorizationCode(code, codeVerifier);
          const claims = decodeIdToken(tokens.idToken()) as { email?: unknown; email_verified?: unknown };
          if (claims.email_verified !== true || typeof claims.email !== "string") return null;
          const email = normalizeEmail(claims.email);
          return email ? { email } : null;
        }
        if (provider === "github" && github) {
          const tokens = await github.validateAuthorizationCode(code);
          const email = await githubVerifiedEmail(tokens.accessToken());
          return email ? { email } : null;
        }
      } catch {
        return null;
      }
      return null;
    },
  };
}
