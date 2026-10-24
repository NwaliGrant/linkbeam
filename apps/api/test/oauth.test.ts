import { afterEach, describe, expect, it, vi } from "vitest";
import { oauthFor } from "../src/oauth";
import type { Bindings } from "../src/env";

// These tests drive the real Arctic-based client, with the network replaced by a stub.
// The provider answers are what Google and GitHub send; nothing leaves this machine.

const env = {
  DB: {} as D1Database,
  APP_URL: "https://linkbeam.test",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  GITHUB_CLIENT_ID: "hid",
  GITHUB_CLIENT_SECRET: "hsecret",
} satisfies Bindings;

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = (claims: unknown): string => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubNetwork(routes: Record<string, () => Response>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const handler = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!handler) throw new Error(`unexpected request to ${url}`);
    return handler();
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("authorization URLs", () => {
  const client = oauthFor(env);

  it("Google: code flow with PKCE, our own callback address, openid and email only", () => {
    const url = client.authorizationUrl("google", "STATE", "V".repeat(43));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("redirect_uri")).toBe("https://linkbeam.test/api/v1/auth/google/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email");
  });

  it("GitHub: asks only for the email scope and uses our callback address", () => {
    const url = client.authorizationUrl("github", "STATE", "unused");
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("user:email");
    expect(url.searchParams.get("redirect_uri")).toBe("https://linkbeam.test/api/v1/auth/github/callback");
  });

  it("reports a provider as unavailable until both its id and secret are set", () => {
    const partial = oauthFor({ DB: env.DB, APP_URL: env.APP_URL, GOOGLE_CLIENT_ID: "gid" });
    expect(partial.isConfigured("google")).toBe(false);
    expect(partial.isConfigured("github")).toBe(false);
    expect(client.isConfigured("google")).toBe(true);
  });
});

describe("Google identity", () => {
  const token = (claims: unknown) => () => jsonResponse({ access_token: "a", token_type: "Bearer", id_token: idToken(claims) });

  it("accepts a verified email and normalises it", async () => {
    stubNetwork({ "https://oauth2.googleapis.com/token": token({ email: "  Person@Example.COM ", email_verified: true }) });
    expect(await oauthFor(env).identify("google", "code", "v")).toEqual({ email: "person@example.com" });
  });

  it("rejects an email Google has not verified (account takeover by registering someone else's address)", async () => {
    stubNetwork({ "https://oauth2.googleapis.com/token": token({ email: "victim@example.com", email_verified: false }) });
    expect(await oauthFor(env).identify("google", "code", "v")).toBeNull();
  });

  it('rejects email_verified given as the string "true", a missing flag and a missing email', async () => {
    for (const claims of [{ email: "a@example.com", email_verified: "true" }, { email: "a@example.com" }, { email_verified: true }]) {
      stubNetwork({ "https://oauth2.googleapis.com/token": token(claims) });
      expect(await oauthFor(env).identify("google", "code", "v")).toBeNull();
    }
  });

  it("returns null, and does not throw, when the code is refused", async () => {
    stubNetwork({ "https://oauth2.googleapis.com/token": () => jsonResponse({ error: "invalid_grant" }, 400) });
    expect(await oauthFor(env).identify("google", "bad", "v")).toBeNull();
  });
});

describe("GitHub identity", () => {
  const accessToken = () => jsonResponse({ access_token: "gho_x", token_type: "bearer" });
  const emails = (list: unknown, status = 200) => () => jsonResponse(list, status);

  it("uses the primary verified email", async () => {
    stubNetwork({
      "https://github.com/login/oauth/access_token": accessToken,
      "https://api.github.com/user/emails": emails([
        { email: "other@example.com", primary: false, verified: true },
        { email: "Main@Example.com", primary: true, verified: true },
      ]),
    });
    expect(await oauthFor(env).identify("github", "code", "v")).toEqual({ email: "main@example.com" });
  });

  it("rejects a primary email that is not verified, and a verified one that is not primary", async () => {
    for (const list of [[{ email: "a@example.com", primary: true, verified: false }], [{ email: "a@example.com", primary: false, verified: true }], []]) {
      stubNetwork({ "https://github.com/login/oauth/access_token": accessToken, "https://api.github.com/user/emails": emails(list) });
      expect(await oauthFor(env).identify("github", "code", "v")).toBeNull();
    }
  });

  it("returns null for an error response or a body that is not a list", async () => {
    for (const handler of [emails({ message: "Bad credentials" }, 401), emails({ not: "a list" }), emails("nope")]) {
      stubNetwork({ "https://github.com/login/oauth/access_token": accessToken, "https://api.github.com/user/emails": handler });
      expect(await oauthFor(env).identify("github", "code", "v")).toBeNull();
    }
  });
});
