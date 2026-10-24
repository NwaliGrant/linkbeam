import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAGIC_LINK_TTL_SECONDS } from "../src/routes/auth";
import { SESSION_TTL_SECONDS } from "../src/sessions";
import { authed, createHarness, json, rowCount, type Harness } from "./helpers";

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

async function requestLink(email: string): Promise<string> {
  const response = await h.request("/api/v1/auth/magic-link", json({ email }));
  expect(response.status).toBe(202);
  const sent = h.mail.at(-1);
  if (!sent) throw new Error("no email was sent");
  return sent.link.replace("https://linkbeam.test", "");
}

function cookieFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  return header ? (header.split(";")[0] ?? null) : null;
}

describe("POST /auth/magic-link", () => {
  it("answers the same for known and unknown emails (no user enumeration)", async () => {
    await h.createUser({ email: "known@example.com" });
    const known = await h.request("/api/v1/auth/magic-link", json({ email: "known@example.com" }));
    const unknown = await h.request("/api/v1/auth/magic-link", json({ email: "nobody@example.com" }));
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.text()).toBe(await unknown.text());
    expect([...known.headers.keys()].sort()).toEqual([...unknown.headers.keys()].sort());
  });

  it("answers the same when the email provider fails", async () => {
    const failing = await createHarness({
      mailer: {
        async sendMagicLink() {
          throw new Error("provider is down");
        },
      },
    });
    try {
      const failed = await failing.request("/api/v1/auth/magic-link", json({ email: "a@example.com" }));
      const worked = await h.request("/api/v1/auth/magic-link", json({ email: "a@example.com" }));
      expect(failed.status).toBe(202);
      expect(await failed.text()).toBe(await worked.text());
    } finally {
      await failing.dispose();
    }
  });

  it("emails a single-use link to the normalised address", async () => {
    await requestLink("  Grant@Example.COM ");
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0]?.email).toBe("grant@example.com");
    expect(h.mail[0]?.link).toMatch(/^https:\/\/linkbeam\.test\/api\/v1\/auth\/callback\?token=[A-Za-z0-9_-]{40,}$/);
  });

  it("rejects malformed emails with 400", async () => {
    const response = await h.request("/api/v1/auth/magic-link", json({ email: "nope" }));
    expect(response.status).toBe(400);
    expect(h.mail).toHaveLength(0);
  });

  it("stores only a hash of the token", async () => {
    const link = await requestLink("a@example.com");
    const token = new URL(`https://x${link}`).searchParams.get("token") ?? "";
    const rows = await h.db.prepare("SELECT token_hash, email FROM login_tokens").all<{ token_hash: string; email: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.results)).not.toContain(token);
  });
});

describe("GET /auth/callback", () => {
  it("signs the user in with a hardened cookie and creates the account", async () => {
    const link = await requestLink("new@example.com");
    const response = await h.request(link, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://linkbeam.test/dashboard");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-lb_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toMatch(/Domain=/i);

    const me = await h.request("/api/v1/me", authed(cookieFrom(response) ?? ""));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe("new@example.com");
    expect(await rowCount(h, "users")).toBe(1);
  });

  it("signs an existing user in without creating a second account", async () => {
    const existing = await h.createUser({ email: "again@example.com" });
    const response = await h.request(await requestLink("again@example.com"), { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(await rowCount(h, "users")).toBe(1);
    const me = await h.request("/api/v1/me", authed(cookieFrom(response) ?? ""));
    expect(((await me.json()) as { id: string }).id).toBe(existing.id);
  });

  it("works only once: a replayed link is rejected", async () => {
    const link = await requestLink("a@example.com");
    const first = await h.request(link, { redirect: "manual" });
    const second = await h.request(link, { redirect: "manual" });
    expect(first.headers.get("set-cookie")).not.toBeNull();
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe("https://linkbeam.test/signin?error=invalid_link");
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an expired link", async () => {
    const link = await requestLink("a@example.com");
    h.clock.now += MAGIC_LINK_TTL_SECONDS + 1;
    const response = await h.request(link, { redirect: "manual" });
    expect(response.headers.get("location")).toContain("error=invalid_link");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("accepts a link just inside the 15 minute window", async () => {
    const link = await requestLink("a@example.com");
    h.clock.now += MAGIC_LINK_TTL_SECONDS - 1;
    const response = await h.request(link, { redirect: "manual" });
    expect(response.headers.get("set-cookie")).not.toBeNull();
  });

  it("rejects tampered, missing and guessed tokens", async () => {
    const link = await requestLink("a@example.com");
    const tampered = `${link.slice(0, -1)}${link.endsWith("A") ? "B" : "A"}`;
    for (const path of [tampered, "/api/v1/auth/callback", "/api/v1/auth/callback?token=", `/api/v1/auth/callback?token=${"a".repeat(43)}`]) {
      const response = await h.request(path, { redirect: "manual" });
      expect(response.headers.get("location")).toContain("error=invalid_link");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(await rowCount(h, "users")).toBe(0);
  });

  it("lets only one of 50 parallel requests use the same link", async () => {
    const link = await requestLink("race@example.com");
    const responses = await Promise.all(Array.from({ length: 50 }, () => h.request(link, { redirect: "manual" })));
    const winners = responses.filter((response) => response.headers.get("set-cookie") !== null);
    expect(winners).toHaveLength(1);
    expect(await rowCount(h, "sessions")).toBe(1);
    expect(await rowCount(h, "users")).toBe(1);
  });

  it("ignores a next parameter and never redirects off-site", async () => {
    const link = await requestLink("a@example.com");
    const response = await h.request(`${link}&next=https://evil.example/steal`, { redirect: "manual" });
    expect(response.headers.get("location")).toBe("https://linkbeam.test/dashboard");
    const failed = await h.request("/api/v1/auth/callback?token=x&next=https://evil.example", { redirect: "manual" });
    expect(failed.headers.get("location")?.startsWith("https://linkbeam.test/")).toBe(true);
  });

  it("does not sign in a banned user", async () => {
    const user = await h.createUser({ email: "banned@example.com" });
    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(user.id).run();
    const response = await h.request(await requestLink("banned@example.com"), { redirect: "manual" });
    expect(response.headers.get("location")).toContain("error=invalid_link");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("gives every sign-in a new session id and ignores a planted cookie (no fixation)", async () => {
    const attackerCookie = "__Host-lb_session=planted-by-attacker";
    const link = await requestLink("victim@example.com");
    const response = await h.request(link, { redirect: "manual", headers: { cookie: attackerCookie } });
    const issued = cookieFrom(response);
    expect(issued).not.toBeNull();
    expect(issued).not.toBe(attackerCookie);

    const withPlanted = await h.request("/api/v1/me", authed(attackerCookie));
    expect(withPlanted.status).toBe(401);

    const secondLink = await requestLink("victim@example.com");
    const second = await h.request(secondLink, { redirect: "manual" });
    expect(cookieFrom(second)).not.toBe(issued);
  });
});

describe("sessions", () => {
  it("rejects requests without a cookie, with a tampered cookie, and after the absolute timeout", async () => {
    const user = await h.createUser();
    expect((await h.request("/api/v1/me")).status).toBe(401);
    expect((await h.request("/api/v1/me", authed(`${user.cookie}x`))).status).toBe(401);
    expect((await h.request("/api/v1/me", authed("lb_session=" + user.cookie.split("=")[1]))).status).toBe(401);
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(200);

    h.clock.now += SESSION_TTL_SECONDS + 1;
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(401);
  });

  it("stores only a hash of the session token", async () => {
    const user = await h.createUser();
    const token = user.cookie.split("=")[1] ?? "";
    const rows = await h.db.prepare("SELECT id_hash FROM sessions").all<{ id_hash: string }>();
    expect(rows.results[0]?.id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.results)).not.toContain(token);
  });

  it("logout destroys the session on the server", async () => {
    const user = await h.createUser();
    const out = await h.request("/api/v1/auth/logout", authed(user.cookie, "POST"));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(401);
    expect(await rowCount(h, "sessions")).toBe(0);
  });

  it("logout needs a session", async () => {
    expect((await h.request("/api/v1/auth/logout", { method: "POST" })).status).toBe(401);
  });

  it("stops serving a user who gets banned", async () => {
    const user = await h.createUser();
    await h.db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?1").bind(user.id).run();
    expect((await h.request("/api/v1/me", authed(user.cookie))).status).toBe(401);
  });

  it("writes login and logout to the audit log with a hashed IP and no email", async () => {
    const link = await requestLink("audit@example.com");
    const response = await h.request(link, { redirect: "manual", headers: { "cf-connecting-ip": "203.0.113.9" } });
    await h.request("/api/v1/auth/logout", authed(cookieFrom(response) ?? "", "POST"));
    const rows = await h.db.prepare("SELECT action, ip_hash FROM audit_log ORDER BY id").all<{ action: string; ip_hash: string | null }>();
    expect(rows.results.map((row) => row.action)).toEqual(["login", "logout"]);
    expect(rows.results[0]?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.results)).not.toContain("203.0.113.9");
    expect(JSON.stringify(rows.results)).not.toContain("audit@example.com");
  });
});
