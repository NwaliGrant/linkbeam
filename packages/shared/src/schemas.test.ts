import { describe, expect, it } from "vitest";
import {
  createLinkSchema,
  linkOrderSchema,
  magicLinkRequestSchema,
  patchLinkSchema,
  profilePatchSchema,
  reportSchema,
  statsQuerySchema,
  trackSchema,
} from "./schemas";

describe("magicLinkRequestSchema", () => {
  it("lowercases the email", () => {
    expect(magicLinkRequestSchema.parse({ email: "A@B.com" })).toEqual({ email: "a@b.com" });
  });

  it("rejects bad emails", () => {
    expect(magicLinkRequestSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(magicLinkRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("profilePatchSchema", () => {
  it("ignores fields it does not know, such as is_banned and user_id", () => {
    const parsed = profilePatchSchema.parse({ bio: "hello", is_banned: false, user_id: "x", id: "y", email: "z@z.com" });
    expect(parsed).toEqual({ bio: "hello" });
  });

  it("enforces length limits and the accent format", () => {
    expect(profilePatchSchema.safeParse({ bio: "a".repeat(161) }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ display_name: "a".repeat(61) }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ accent: "red" }).success).toBe(false);
    expect(profilePatchSchema.parse({ accent: "#0b6b3a" })).toEqual({ accent: "#0B6B3A" });
    expect(profilePatchSchema.parse({ accent: null })).toEqual({ accent: null });
  });

  it("rejects unknown themes and reserved usernames", () => {
    expect(profilePatchSchema.safeParse({ theme: "neon" }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ username: "admin" }).success).toBe(false);
    expect(profilePatchSchema.parse({ username: "Grant" })).toEqual({ username: "grant" });
  });
});

describe("createLinkSchema", () => {
  it("defaults the kind to url and normalises the target", () => {
    const parsed = createLinkSchema.parse({ title: " My site ", target: "https://Example.com" });
    expect(parsed).toMatchObject({ kind: "url", title: "My site", target: "https://example.com/" });
  });

  it("validates the target against the kind", () => {
    expect(createLinkSchema.safeParse({ kind: "whatsapp", title: "Chat", target: "https://example.com" }).success).toBe(false);
    expect(createLinkSchema.parse({ kind: "whatsapp", title: "Chat", target: "+234 801 234 5678" }).target).toBe("+2348012345678");
  });

  it("rejects dangerous URLs, empty titles, long titles and reversed schedules", () => {
    expect(createLinkSchema.safeParse({ title: "x", target: "javascript:alert(1)" }).success).toBe(false);
    expect(createLinkSchema.safeParse({ title: "   ", target: "https://example.com" }).success).toBe(false);
    expect(createLinkSchema.safeParse({ title: "a".repeat(61), target: "https://example.com" }).success).toBe(false);
    expect(
      createLinkSchema.safeParse({ title: "x", target: "https://example.com", starts_at: 200, ends_at: 100 }).success,
    ).toBe(false);
  });

  it("does not accept a user_id, position or id from the client", () => {
    const parsed = createLinkSchema.parse({ title: "x", target: "https://example.com", user_id: "evil", id: "evil", position: 0 });
    expect(parsed).not.toHaveProperty("user_id");
    expect(parsed).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("position");
  });
});

describe("patchLinkSchema", () => {
  it("allows partial updates and ignores kind changes", () => {
    expect(patchLinkSchema.parse({ enabled: false, kind: "coffee" })).toEqual({ enabled: false });
  });

  it("still checks the schedule order", () => {
    expect(patchLinkSchema.safeParse({ starts_at: 5, ends_at: 1 }).success).toBe(false);
  });
});

describe("other request schemas", () => {
  it("limits the order list to 30 valid ids", () => {
    expect(linkOrderSchema.safeParse({ ids: Array.from({ length: 31 }, (_, i) => `id-${i}-abcdef`) }).success).toBe(false);
    expect(linkOrderSchema.safeParse({ ids: ["bad id!"] }).success).toBe(false);
    expect(linkOrderSchema.safeParse({ ids: ["abcdefgh1", "abcdefgh2"] }).success).toBe(true);
  });

  it("parses track, report and stats queries", () => {
    expect(trackSchema.safeParse({ page: "grant" }).success).toBe(true);
    expect(trackSchema.safeParse({ page: "grant", link: "bad id" }).success).toBe(false);
    expect(reportSchema.safeParse({ page: "grant", reason: "" }).success).toBe(false);
    expect(reportSchema.safeParse({ page: "grant", reason: "x".repeat(501) }).success).toBe(false);
    expect(statsQuerySchema.parse({})).toEqual({ days: 7 });
    expect(statsQuerySchema.parse({ days: "30" })).toEqual({ days: 30 });
    expect(statsQuerySchema.safeParse({ days: "9999" }).success).toBe(false);
  });
});
