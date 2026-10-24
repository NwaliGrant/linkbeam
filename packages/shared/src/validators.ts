export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/** Words that must never become a public page, because they collide with routes or imply authority. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "api", "app", "about", "account", "assets", "auth", "billing", "blog",
  "callback", "contact", "dashboard", "design", "docs", "download", "editor", "email", "explore",
  "faq", "feed", "help", "home", "index", "legal", "link", "links", "linkbeam", "login", "logout",
  "me", "moderator", "new", "null", "onboarding", "official", "pricing", "privacy", "profile",
  "register", "report", "root", "security", "settings", "share", "signin", "signout", "signup",
  "stats", "status", "support", "system", "terms", "track", "u", "undefined", "user", "users",
  "www", "abuse", "noreply", "owner", "postmaster", "press", "sales", "staff", "team", "verified", "webmaster",
]);

/**
 * A name with the tricks taken out: no hyphens or underscores, and look-alike characters made equal
 * (1 and i look like l, 0 like o, rn like m ...). Two names with the same skeleton look the same to a reader.
 */
export function usernameSkeleton(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]/g, "")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[0]/g, "o")
    .replace(/[1il]/g, "l")
    .replace(/3/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[8]/g, "b")
    .replace(/[9]/g, "g");
}

const RESERVED_SKELETONS: ReadonlySet<string> = new Set([...RESERVED_USERNAMES].map(usernameSkeleton));

export type UsernameCheck = { ok: true; username: string } | { ok: false; reason: string };

export function checkUsername(raw: string): UsernameCheck {
  const username = raw.trim().toLowerCase();
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return { ok: false, reason: `Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.` };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, reason: "Use only a-z, 0-9, underscore and hyphen." };
  }
  if (RESERVED_USERNAMES.has(username) || RESERVED_SKELETONS.has(usernameSkeleton(username))) {
    return { ok: false, reason: "This name is reserved. Please choose another." };
  }
  return { ok: true, username };
}

export const MAX_URL_LENGTH = 2048;
export const MAX_LINKS_PER_USER = 30;

export type LinkKind = "url" | "whatsapp" | "coffee" | "call" | "email" | "map";
export const LINK_KINDS: readonly LinkKind[] = ["url", "whatsapp", "coffee", "call", "email", "map"];

const WEB_URL_START = /^https?:\/\//i;
// Any whitespace, control or invisible formatting character. The URL parser would silently drop
// some of these (tab, newline), which is how "java\tscript:" style tricks work, so we reject them first.
// eslint-disable-next-line no-control-regex -- matching control characters is the whole purpose of this pattern
const FORBIDDEN_URL_CHARS =/[\s\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2060\ufeff\\]/;

/** Accept only plain http(s) web addresses. Returns the normalised address, or null. */
export function normalizeWebUrl(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  if (FORBIDDEN_URL_CHARS.test(raw)) return null;
  if (!WEB_URL_START.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (!parsed.hostname.includes(".")) return null;

  const normalised = parsed.href;
  // Re-check after parsing, as the brief requires.
  if (normalised.length > MAX_URL_LENGTH || FORBIDDEN_URL_CHARS.test(normalised)) return null;
  if (!WEB_URL_START.test(normalised)) return null;
  return normalised;
}

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
// Deliberately simple. Real validation is the confirmation email, not a regex.
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function normalizePhone(raw: string): string | null {
  let compact = raw.replace(/[\s().-]/g, "");
  // "00" is how many countries write "+" when dialling abroad.
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  return PHONE_PATTERN.test(compact) ? compact : null;
}

// Stricter than the sign-in check: a button's address ends up inside a mailto: link, so characters such as
// ? & = # (which could add a copy-to address or a message body) are never allowed.
const LINK_EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function normalizeLinkEmail(raw: string): string | null {
  const email = normalizeEmail(raw);
  return email !== null && LINK_EMAIL_PATTERN.test(email) ? email : null;
}

/** Only https. Payments over plain http can be read or changed on the way, so they are refused. */
export function normalizeHttpsUrl(raw: string): string | null {
  const url = normalizeWebUrl(raw);
  return url !== null && url.startsWith("https://") ? url : null;
}

const MAP_QUERY_MIN = 5;
const MAP_QUERY_MAX = 200;
// Anything that starts like "scheme:" is not an address (javascript:, data:, tel: ...).
const LOOKS_LIKE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// eslint-disable-next-line no-control-regex -- matching control characters is the whole purpose of this pattern
const MAP_HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff<>]/;

/** A map button takes a web link (any map app) or a plain address, which becomes a Google Maps search link. */
export function normalizeMapTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (WEB_URL_START.test(trimmed)) return normalizeWebUrl(trimmed);
  if (trimmed.length < MAP_QUERY_MIN || trimmed.length > MAP_QUERY_MAX) return null;
  if (LOOKS_LIKE_SCHEME.test(trimmed) || trimmed.includes("//") || MAP_HIDDEN.test(trimmed)) return null;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed.replace(/\s+/g, " "))}`;
}

// The only web addresses a "Buy me a coffee" button may open. Linkbeam never handles money; the button
// only opens the owner's own page on Buy Me a Coffee.
const COFFEE_HOSTS: ReadonlySet<string> = new Set(["buymeacoffee.com", "www.buymeacoffee.com", "coff.ee"]);

/** An https address on Buy Me a Coffee, with a page name after the host. */
export function normalizeCoffeeUrl(raw: string): string | null {
  const clean = normalizeHttpsUrl(raw);
  if (clean === null) return null;
  const url = new URL(clean);
  if (!COFFEE_HOSTS.has(url.hostname)) return null;
  if (url.pathname.replace(/\//g, "") === "") return null;
  return clean;
}

/** Validate and normalise a link target for its kind. Returns null when it is not acceptable. */
export function normalizeTarget(kind: LinkKind, raw: string): string | null {
  switch (kind) {
    case "url":
      return normalizeWebUrl(raw);
    case "coffee":
      return normalizeCoffeeUrl(raw);
    case "map":
      return normalizeMapTarget(raw);
    case "whatsapp":
    case "call":
      return normalizePhone(raw);
    case "email":
      return normalizeLinkEmail(raw);
  }
}

export function isValidAccent(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Return the new order of ids only if it is exactly a permutation of the current ids. */
export function isPermutation(current: readonly string[], proposed: readonly string[]): boolean {
  if (current.length !== proposed.length) return false;
  const expected = new Set(current);
  const seen = new Set<string>();
  for (const id of proposed) {
    if (!expected.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// Characters a reader cannot see, or that change how text is ordered or broken into lines. They let one person
// look like another (right-to-left override), so they are refused in every name, title and bio.
// The zero-width joiner and non-joiner are allowed: emoji and several scripts need them.
// eslint-disable-next-line no-control-regex -- matching control characters is the whole purpose of this pattern
const HIDDEN_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;

/** True when the text has no hidden or direction-changing characters. New lines and tabs are allowed only when asked for. */
export function isPlainText(value: string, allowNewLine = false): boolean {
  if (HIDDEN_TEXT.test(value)) return false;
  return allowNewLine || !/[\n\t]/.test(value);
}
