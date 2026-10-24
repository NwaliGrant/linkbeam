import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USERNAME_COOLDOWN_SECONDS } from "../src/routes/me";
import { FRESH_SESSION_SECONDS } from "../src/sessions";
import { addLink, authed, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";
import { SECRET, concatBytes, contains, decodes, makeImage, text } from "./images";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
});

interface Profile {
  id: string;
  email: string;
  username: string | null;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  theme: string;
  accent: string | null;
}

const patch = (user: TestUser, body: unknown) => h.request("/api/v1/me", json(body, user.cookie, "PATCH"));

function upload(user: TestUser, bytes: Uint8Array, name = "photo.jpg", type = "image/jpeg") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: user.cookie }, body: form });
}

describe("GET and PATCH /me", () => {
  it("returns the signed-in profile", async () => {
    const user = await h.createUser({ email: "me@example.com", username: "grant" });
    const response = await h.request("/api/v1/me", authed(user.cookie));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: user.id,
      email: "me@example.com",
      username: "grant",
      display_name: "",
      bio: "",
      avatar_url: null,
      theme: "forest",
      accent: null,
    });
  });

  it("has the original look by default, for new accounts and after the migration", async () => {
    const user = await h.createUser();
    expect(await (await h.request("/api/v1/me", authed(user.cookie))).json()).toMatchObject({
      button_shape: "pill",
      font_pair: "friendly",
      bg_style: "solid",
      show_badge: true,
    });
  });

  it("saves the Design tab settings one at a time without touching the others", async () => {
    const user = await h.createUser();
    await patch(user, { theme: "sunset", accent: "#C2410C" });
    for (const change of [{ button_shape: "square" }, { font_pair: "clean" }, { bg_style: "pattern" }, { show_badge: false }]) {
      expect((await patch(user, change)).status).toBe(200);
    }
    expect(await (await h.request("/api/v1/me", authed(user.cookie))).json()).toMatchObject({
      theme: "sunset",
      accent: "#C2410C",
      button_shape: "square",
      font_pair: "clean",
      bg_style: "pattern",
      show_badge: false,
    });
    expect(((await (await patch(user, { show_badge: true })).json()) as { show_badge: boolean }).show_badge).toBe(true);
  });

  it("rejects unknown design values, wrong types and SQL text", async () => {
    const user = await h.createUser();
    for (const body of [{ button_shape: "star" }, { font_pair: "comic" }, { bg_style: "video" }, { show_badge: "no" }, { show_badge: 0 }, { button_shape: "pill'; DROP TABLE users;--" }]) {
      expect((await patch(user, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("updates the profile fields", async () => {
    const user = await h.createUser();
    const response = await patch(user, { display_name: " Grant ", bio: "Designer", theme: "ink", accent: "#0b6b3a" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ display_name: "Grant", bio: "Designer", theme: "ink", accent: "#0B6B3A" });
    const cleared = await patch(user, { accent: null });
    expect(((await cleared.json()) as Profile).accent).toBeNull();
  });

  it("claims a username once and normalises it", async () => {
    const user = await h.createUser();
    const response = await patch(user, { username: "Grant_01" });
    expect(((await response.json()) as Profile).username).toBe("grant_01");
  });

  it.each(["admin", "ab", "has space", "UPPER!", "a".repeat(31)])("rejects the username %j", async (username) => {
    const user = await h.createUser();
    const response = await patch(user, { username });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalid_input");
  });

  it("returns 409 for a taken username, in any letter case", async () => {
    await h.createUser({ username: "taken" });
    const user = await h.createUser();
    const response = await patch(user, { username: "TAKEN" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("username_taken");
  });

  it("rate-limits username changes with a cooldown, but not the first claim", async () => {
    const user = await h.createUser();
    expect((await patch(user, { username: "first" })).status).toBe(200);
    expect((await patch(user, { username: "second" })).status).toBe(200);
    const blocked = await patch(user, { username: "third" });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("username_cooldown");

    h.clock.now += USERNAME_COOLDOWN_SECONDS + 1;
    expect((await patch(user, { username: "third" })).status).toBe(200);
  });

  it("does not start a cooldown when the username is unchanged", async () => {
    const user = await h.createUser({ username: "same" });
    expect((await patch(user, { username: "same", bio: "x" })).status).toBe(200);
    expect((await patch(user, { username: "other" })).status).toBe(200);
  });

  it("rejects bad values", async () => {
    const user = await h.createUser();
    for (const body of [{ bio: "x".repeat(161) }, { theme: "neon" }, { accent: "red" }, { display_name: "x".repeat(61) }]) {
      expect((await patch(user, body)).status).toBe(400);
    }
  });

  it("requires a session", async () => {
    expect((await h.request("/api/v1/me", json({ bio: "x" }, undefined, "PATCH"))).status).toBe(401);
  });

  it("stores script-like text as plain text and returns it unchanged for the client to encode", async () => {
    const user = await h.createUser();
    const payload = '<img src=x onerror=alert(1)>"\'';
    const response = await patch(user, { display_name: payload.slice(0, 60), bio: payload });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(((await response.json()) as Profile).bio).toBe(payload);
  });

  it("is not fooled by SQL in text fields", async () => {
    const user = await h.createUser();
    const other = await h.createUser({ username: "innocent" });
    const response = await patch(user, { bio: "'; DROP TABLE users; --", display_name: "x' OR '1'='1" });
    expect(response.status).toBe(200);
    expect(await rowCount(h, "users")).toBe(2);
    const otherProfile = await h.request("/api/v1/me", authed(other.cookie));
    expect(((await otherProfile.json()) as Profile).bio).toBe("");
  });
});

describe("POST /me/avatar", () => {
  it("accepts a photo, strips its metadata and serves it with safe headers", async () => {
    const user = await h.createUser({ username: "pic" });
    const original = await makeImage("jpeg", { withExif: true });
    const response = await upload(user, concatBytes(original, text("<script>alert(1)</script>")));
    expect(response.status).toBe(201);
    const { avatar_url } = (await response.json()) as { avatar_url: string };
    expect(avatar_url).toMatch(/^\/api\/v1\/avatar\/[A-Za-z0-9_-]{20,}$/);

    const me = (await (await h.request("/api/v1/me", authed(user.cookie))).json()) as Profile;
    expect(me.avatar_url).toBe(avatar_url);

    const served = await h.request(avatar_url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toContain("default-src 'none'");
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(contains(bytes, SECRET)).toBe(false);
    expect(contains(bytes, "<script>")).toBe(false);
    expect(await decodes(bytes)).toEqual({ width: 32, height: 32, exif: false });
  });

  it("trusts the file's bytes, not its name or declared type", async () => {
    const user = await h.createUser();
    const response = await upload(user, await makeImage("png"), "evil.html", "text/html");
    expect(response.status).toBe(201);
    const { avatar_url } = (await response.json()) as { avatar_url: string };
    expect((await h.request(avatar_url)).headers.get("content-type")).toBe("image/png");
  });

  it.each([
    ["an SVG with a script", text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "a.svg", "image/svg+xml"],
    ["an HTML file named like a photo", text("<html><script>alert(1)</script>"), "a.jpg", "image/jpeg"],
    ["an empty file", new Uint8Array(), "a.jpg", "image/jpeg"],
  ])("rejects %s", async (_label, bytes, name, type) => {
    const user = await h.createUser();
    const response = await upload(user, bytes, name, type);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalid_image");
    expect(await rowCount(h, "avatars")).toBe(0);
  });

  it("rejects a photo over 1 MB with 413", async () => {
    const user = await h.createUser();
    const big = concatBytes(await makeImage("jpeg"), new Uint8Array(1_048_576));
    expect((await upload(user, big)).status).toBe(413);
    const huge = new Uint8Array(1_500_000);
    expect((await upload(user, huge)).status).toBe(413);
  });

  it("rejects requests that are not multipart and requests without a file", async () => {
    const user = await h.createUser();
    expect((await h.request("/api/v1/me/avatar", json({}, user.cookie))).status).toBe(415);
    const empty = new FormData();
    empty.append("other", "x");
    const response = await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: user.cookie }, body: empty });
    expect(response.status).toBe(400);
  });

  it("replaces the old photo", async () => {
    const user = await h.createUser();
    const first = (await (await upload(user, await makeImage("jpeg"))).json()) as { avatar_url: string };
    const second = (await (await upload(user, await makeImage("png"))).json()) as { avatar_url: string };
    expect(second.avatar_url).not.toBe(first.avatar_url);
    expect((await h.request(first.avatar_url)).status).toBe(404);
    expect((await h.request(second.avatar_url)).status).toBe(200);
    expect(await rowCount(h, "avatars")).toBe(1);
  });

  it("requires a session", async () => {
    const form = new FormData();
    form.append("file", new File([await makeImage("jpeg")], "a.jpg"));
    expect((await h.request("/api/v1/me/avatar", { method: "POST", body: form })).status).toBe(401);
  });

  it("returns 404 for unknown photo keys", async () => {
    expect((await h.request("/api/v1/avatar/does-not-exist")).status).toBe(404);
  });
});

describe("GET /me/export and DELETE /me", () => {
  it("exports the user's own data as JSON", async () => {
    const user = await h.createUser({ username: "exporter" });
    await addLink(h, user, { title: "Site" });
    await upload(user, await makeImage("jpeg"));
    const response = await h.request("/api/v1/me/export", authed(user.cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const body = (await response.json()) as { profile: Profile; links: unknown[]; avatar: { content_type: string; base64: string } | null };
    expect(body.profile.email).toBe(user.email);
    expect(body.links).toHaveLength(1);
    expect(body.avatar?.content_type).toBe("image/jpeg");
    expect(Buffer.from(body.avatar?.base64 ?? "", "base64").length).toBeGreaterThan(100);
    expect(await rowCount(h, "audit_log", "action = 'export'")).toBe(1);
  });

  it("asks for a recent sign-in before exporting or deleting", async () => {
    const user = await h.createUser();
    h.clock.now += FRESH_SESSION_SECONDS + 1;
    for (const [path, method] of [["/api/v1/me/export", "GET"], ["/api/v1/me", "DELETE"]] as const) {
      const response = await h.request(path, authed(user.cookie, method));
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("reauth_required");
    }
    expect(await rowCount(h, "users")).toBe(1);
  });

  it("deletes the account and everything attached to it, and nothing else", async () => {
    const user = await h.createUser({ username: "leaving" });
    const bystander = await h.createUser({ username: "staying" });
    const link = await addLink(h, user);
    const kept = await addLink(h, bystander);
    await upload(user, await makeImage("jpeg"));
    await upload(bystander, await makeImage("jpeg"));
    await h.request("/api/v1/track", json({ page: "leaving" }));
    await h.request("/api/v1/track", json({ page: "leaving", link: link.id }));
    await h.request("/api/v1/track", json({ page: "staying", link: kept.id }));
    await h.request("/api/v1/report", json({ page: "leaving", reason: "test" }));

    const response = await h.request("/api/v1/me", authed(user.cookie, "DELETE"));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    for (const table of ["users", "sessions", "links", "avatars", "daily_stats", "reports"]) {
      const column = table === "users" ? "id" : "user_id";
      expect(await rowCount(h, table, `${column} = '${user.id}'`), table).toBe(0);
    }
    expect(await rowCount(h, "audit_log", `user_id = '${user.id}'`)).toBe(0);
    expect(await rowCount(h, "audit_log", "action = 'delete' AND user_id IS NULL")).toBe(1);

    expect((await h.request("/api/v1/u/leaving")).status).toBe(404);
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(401);

    expect(await rowCount(h, "users", `id = '${bystander.id}'`)).toBe(1);
    expect(await rowCount(h, "links", `user_id = '${bystander.id}'`)).toBe(1);
    expect(await rowCount(h, "avatars", `user_id = '${bystander.id}'`)).toBe(1);
    expect(await rowCount(h, "daily_stats", `user_id = '${bystander.id}'`)).toBe(1);
  });

  it("frees the username for someone else after deletion", async () => {
    const user = await h.createUser({ username: "reusable" });
    await h.request("/api/v1/me", authed(user.cookie, "DELETE"));
    const next = await h.createUser();
    expect((await patch(next, { username: "reusable" })).status).toBe(200);
  });
});
