import type { OAuthClient } from "./oauth";
import type { Limits, Rule, Verdict } from "./ratelimit";
import type { TurnstileVerifier } from "./turnstile";

export interface Bindings {
  DB: D1Database;
  /** Public origin of the site, for example https://linkbeam.pages.dev. The API is served under /api/v1 on the same host. */
  APP_URL: string;
  /** "console" prints magic links (local development only). "brevo" sends real email. Anything else sends nothing. */
  MAIL_MODE?: string;
  /** Brevo API key (secret). Only used when MAIL_MODE is "brevo". */
  BREVO_API_KEY?: string;
  /** The sender address, which must be verified in Brevo. Not secret. */
  BREVO_SENDER_EMAIL?: string;
  /** Secret used to hash visitor IPs for the audit log. When missing, no IP hash is stored. */
  IP_HASH_SECRET?: string;
  /** Cloudflare Turnstile secret key. Without it the bot check only passes in local development. */
  TURNSTILE_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export interface Mailer {
  sendMagicLink(email: string, link: string): Promise<void>;
}

export interface SessionUser {
  id: string;
  email: string;
  username: string | null;
  username_changed_at: number | null;
  display_name: string;
  bio: string;
  avatar_key: string | null;
  theme: string;
  accent: string | null;
  button_shape: string;
  font_pair: string;
  bg_style: string;
  show_badge: number;
  created_at: number;
}

export interface SessionInfo {
  idHash: string;
  createdAt: number;
}

export interface Variables {
  now: number;
  mailer: Mailer;
  turnstile: TurnstileVerifier;
  oauth: OAuthClient;
  limits: Limits;
  trackLimit: (id: string, rule: Rule, now: number) => Verdict;
  user: SessionUser;
  session: SessionInfo;
  /** A route can set its own Content-Security-Policy. It replaces the strict default. */
  csp?: string;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };

export interface Deps {
  mailer?: Mailer;
  now?: () => number;
  turnstile?: TurnstileVerifier;
  oauth?: OAuthClient;
  /** Tests can override individual limits. */
  limits?: Partial<Limits>;
}
