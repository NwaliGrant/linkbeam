import { clearLocalData } from "./drafts";
import type { BgStyle, ButtonShape, FontPair, LinkKind, ThemeId } from "@linkbeam/shared";

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  theme: ThemeId;
  accent: string | null;
  button_shape: ButtonShape;
  font_pair: FontPair;
  bg_style: BgStyle;
  show_badge: boolean;
  created_at: number;
}

export type ProfilePatch = Partial<
  Pick<Profile, "username" | "display_name" | "bio" | "theme" | "accent" | "button_shape" | "font_pair" | "bg_style" | "show_badge">
>;

export interface LinkItem {
  id: string;
  kind: LinkKind;
  title: string;
  target: string;
  message: string | null;
  position: number;
  enabled: boolean;
  starts_at: number | null;
  ends_at: number | null;
}

export interface NewLink {
  kind: LinkKind;
  title: string;
  target: string;
  message?: string | null;
}

export type LinkPatch = Partial<Pick<LinkItem, "title" | "target" | "message" | "enabled" | "starts_at" | "ends_at">>;

export interface Stats {
  days: number;
  totals: { views: number; clicks: number };
  daily: Array<{ date: string; views: number; clicks: number }>;
  top_links: Array<{ id: string; title: string; clicks: number }>;
}

const NETWORK_MESSAGE = "We could not reach the server. Check your connection and try again.";

/** All calls go to the same host as the page, so the session cookie is first-party. */
async function call(path: string, init: RequestInit = {}, keepalive = false): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "same-origin", keepalive });
  } catch {
    throw new ApiFailure(0, "network", NETWORK_MESSAGE);
  }
  if (response.ok) return response;
  let code = "server_error";
  let message = "Something went wrong. Please try again.";
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the generic message when the body is not our error shape.
  }
  throw new ApiFailure(response.status, code, message);
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await call(path, init)).json() as Promise<T>;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const api = {
  me: () => json<Profile>("/me"),
  patchMe: (patch: ProfilePatch) => json<Profile>("/me", send("PATCH", patch)),
  links: async () => (await json<{ links: LinkItem[] }>("/links")).links,
  createLink: (link: NewLink) => json<LinkItem>("/links", send("POST", link)),
  patchLink: (id: string, patch: LinkPatch) => json<LinkItem>(`/links/${encodeURIComponent(id)}`, send("PATCH", patch)),
  deleteLink: async (id: string, keepalive = false): Promise<void> => {
    await call(`/links/${encodeURIComponent(id)}`, { method: "DELETE" }, keepalive);
  },
  reorder: async (ids: string[]): Promise<void> => {
    await call("/links/order", send("PUT", { ids }));
  },
  uploadAvatar: async (file: Blob): Promise<string> => {
    const form = new FormData();
    form.append("file", file, "avatar.jpg");
    return (await (await call("/me/avatar", { method: "POST", body: form })).json() as { avatar_url: string }).avatar_url;
  },
  report: async (page: string, reason: string, turnstileToken?: string): Promise<void> => {
    await call("/report", send("POST", { page, reason, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) }));
  },
  stats: (days: 7 | 30) => json<Stats>(`/me/stats?days=${days}`),
  requestMagicLink: async (email: string, turnstileToken?: string): Promise<void> => {
    await call("/auth/magic-link", send("POST", { email, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) }));
  },
  logout: async (): Promise<void> => {
    clearLocalData();
    await call("/auth/logout", { method: "POST" });
  },
  logoutAll: async (): Promise<void> => {
    clearLocalData();
    await call("/auth/logout-all", { method: "POST" });
  },
  exportData: async (): Promise<Blob> => (await call("/me/export")).blob(),
  deleteAccount: async (): Promise<void> => {
    await call("/me", { method: "DELETE" });
    clearLocalData();
  },
};
