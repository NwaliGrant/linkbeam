import { BG_STYLES, BUTTON_SHAPES, FONT_PAIRS, LINK_KINDS, THEMES, isValidAccent, normalizeTarget, patchLinkSchema, profilePatchSchema } from "@linkbeam/shared";
import type { LinkItem, LinkPatch, Profile, ProfilePatch } from "./api";

/**
 * Offline support for the dashboard.
 *
 * Two things are kept on this device (localStorage), and both are removed when the person signs out or deletes their account:
 *  - a snapshot: the last profile and links the server sent, so the dashboard can open with no connection;
 *  - drafts: edits that have not reached the server yet, so a closed tab or a dead connection loses nothing.
 *
 * Only edits to things that already exist are kept offline (text, design, show/hide, dates). Adding, deleting and
 * reordering links, the username and the photo need the server, and the dashboard says so.
 */

export const SNAPSHOT_KEY = "linkbeam-snapshot-v1";
export const DRAFTS_KEY = "linkbeam-drafts-v1";

export interface Snapshot {
  profile: Profile;
  links: LinkItem[];
  savedAt: number;
}

export interface Drafts {
  userId: string;
  profile: ProfilePatch;
  links: Record<string, LinkPatch>;
}

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = (list: readonly string[], value: unknown): boolean => typeof value === "string" && list.includes(value);

/**
 * Anything read back from storage is checked like input from the internet. Storage can be damaged, filled by an older
 * version, or edited by hand, and a bad value (for example an unknown theme) must never be able to break the dashboard
 * on every start. Invalid data is dropped, and the dashboard falls back to what the server sends.
 */
function validSnapshot(value: unknown): value is Snapshot {
  if (!isObject(value) || !isObject(value.profile) || !Array.isArray(value.links)) return false;
  const p = value.profile;
  const profileOk =
    typeof p.id === "string" && typeof p.email === "string" && (p.username === null || typeof p.username === "string") &&
    typeof p.display_name === "string" && typeof p.bio === "string" && (p.avatar_url === null || typeof p.avatar_url === "string") &&
    oneOf(THEMES, p.theme) && oneOf(BUTTON_SHAPES, p.button_shape) && oneOf(FONT_PAIRS, p.font_pair) && oneOf(BG_STYLES, p.bg_style) &&
    (p.accent === null || (typeof p.accent === "string" && isValidAccent(p.accent))) && typeof p.show_badge === "boolean";
  if (!profileOk) return false;
  return value.links.every(
    (l) =>
      isObject(l) && typeof l.id === "string" && oneOf(LINK_KINDS, l.kind) && typeof l.title === "string" && typeof l.target === "string" &&
      (l.message === null || typeof l.message === "string") && typeof l.enabled === "boolean" &&
      (l.starts_at === null || typeof l.starts_at === "number") && (l.ends_at === null || typeof l.ends_at === "number") && typeof l.position === "number",
  );
}

const draftProfileSchema = profilePatchSchema.omit({ username: true });

/** After sign-out or account deletion nothing may be written again, even by a save that was still on its way. */
let wiped = false;

function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read<T>(store: Store | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: Store | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked (private browsing). The dashboard still works, it just cannot keep drafts.
  }
}

export function saveSnapshot(profile: Profile, links: LinkItem[], store?: Store | null, now = Date.now()): void {
  if (store === undefined && wiped) return;
  write(store === undefined ? browserStore() : store, SNAPSHOT_KEY, { profile, links, savedAt: now } satisfies Snapshot);
}

export function loadSnapshot(store?: Store | null): Snapshot | null {
  const value = read<unknown>(store === undefined ? browserStore() : store, SNAPSHOT_KEY);
  return validSnapshot(value) ? value : null;
}

export function saveDrafts(userId: string, profile: ProfilePatch, links: Map<string, LinkPatch>, explicit?: Store | null): void {
  if (explicit === undefined && wiped) return;
  const store = explicit === undefined ? browserStore() : explicit;
  const linkDrafts: Record<string, LinkPatch> = {};
  for (const [id, patch] of links) if (Object.keys(patch).length > 0) linkDrafts[id] = patch;
  if (Object.keys(profile).length === 0 && Object.keys(linkDrafts).length === 0) {
    try {
      store?.removeItem(DRAFTS_KEY);
    } catch {
      // Nothing to do.
    }
    return;
  }
  write(store, DRAFTS_KEY, { userId, profile, links: linkDrafts } satisfies Drafts);
}

/** Drafts belong to one account. Drafts of another account are ignored, never applied. */
export function loadDrafts(userId: string, store?: Store | null): Drafts | null {
  const value = read<unknown>(store === undefined ? browserStore() : store, DRAFTS_KEY);
  if (!isObject(value) || value.userId !== userId || !isObject(value.profile) || !isObject(value.links)) return null;
  // The whole profile draft is dropped if any part is invalid. Link drafts are checked one by one in applyDrafts.
  const profile = draftProfileSchema.safeParse(value.profile);
  return { userId, profile: profile.success ? (profile.data as ProfilePatch) : {}, links: value.links as Record<string, LinkPatch> };
}

/** Applies drafts to what the server sent. Drafts for links that no longer exist are dropped. */
export function applyDrafts(
  profile: Profile,
  links: LinkItem[],
  drafts: Drafts,
): { profile: Profile; links: LinkItem[]; profilePatch: ProfilePatch; linkPatches: Map<string, LinkPatch> } {
  const byId = new Map(links.map((link) => [link.id, link]));
  const linkPatches = new Map<string, LinkPatch>();
  for (const [id, patch] of Object.entries(drafts.links)) {
    const link = byId.get(id);
    if (!link) continue;
    const checked = patchLinkSchema.safeParse(patch);
    const targetOk = typeof patch.target !== "string" || normalizeTarget(link.kind, patch.target) !== null;
    if (checked.success && targetOk) linkPatches.set(id, checked.data as LinkPatch);
  }
  return {
    profile: { ...profile, ...drafts.profile },
    links: links.map((link) => (linkPatches.has(link.id) ? { ...link, ...linkPatches.get(link.id) } : link)),
    profilePatch: drafts.profile,
    linkPatches,
  };
}

/** Removes everything this feature keeps on the device. Called when signing out and when deleting the account. */
export function clearLocalData(explicit?: Store | null): void {
  if (explicit === undefined) wiped = true;
  const store = explicit === undefined ? browserStore() : explicit;
  for (const key of [SNAPSHOT_KEY, DRAFTS_KEY]) {
    try {
      store?.removeItem(key);
    } catch {
      // Nothing to do.
    }
  }
}
