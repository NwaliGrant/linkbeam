import { describe, expect, it, vi } from "vitest";
import { brevoMailer, mailerFor } from "../src/mailer";
import type { Bindings } from "../src/env";

const LINK = "https://linkbeam.example/api/v1/auth/callback?token=abcDEF123";

function fakeFetch(status: number) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 201 ? '{"messageId":"x"}' : '{"message":"secret@example.com rejected"}', { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("brevoMailer", () => {
  it("posts one message to Brevo with the key in a header and the link in the text and the button", async () => {
    const { impl, calls } = fakeFetch(201);
    await brevoMailer("KEY123", "hello@linkbeam.example", impl).sendMagicLink("ada@example.com", LINK);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.brevo.com/v3/smtp/email");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("KEY123");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.to).toEqual([{ email: "ada@example.com" }]);
    expect(body.sender).toEqual({ name: "Linkbeam", email: "hello@linkbeam.example" });
    expect(body.textContent).toContain(LINK);
    expect(body.textContent).toContain("15 minutes");
    expect(body.htmlContent).toContain(`href="${LINK}"`);
    expect(JSON.stringify(body)).not.toContain("KEY123");
  });

  it("escapes the link in the HTML part", async () => {
    const { impl, calls } = fakeFetch(201);
    await brevoMailer("K", "a@b.c", impl).sendMagicLink("ada@example.com", `https://x.example/?a="><script>alert(1)</script>`);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.htmlContent).not.toContain("<script>");
    expect(body.htmlContent).toContain("&lt;script&gt;");
  });

  it("throws on a refusal and logs only the status, never the address, the link or the reply", async () => {
    const { impl } = fakeFetch(401);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(brevoMailer("bad", "a@b.c", impl).sendMagicLink("secret@example.com", LINK)).rejects.toThrow("Brevo status 401");
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("401");
    expect(logged).not.toContain("secret@example.com");
    expect(logged).not.toContain("abcDEF123");
    log.mockRestore();
  });
});

describe("mailerFor", () => {
  const base = { DB: {} as D1Database, APP_URL: "https://linkbeam.example" } satisfies Bindings;

  it("uses Brevo only when the mode and both settings are present", async () => {
    const { impl, calls } = fakeFetch(201);
    await mailerFor({ ...base, MAIL_MODE: "brevo", BREVO_API_KEY: "k", BREVO_SENDER_EMAIL: "a@b.c" }, impl).sendMagicLink("ada@example.com", LINK);
    expect(calls).toHaveLength(1);
  });

  it("sends nothing and says so in the log when a Brevo setting is missing", async () => {
    const { impl, calls } = fakeFetch(201);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await mailerFor({ ...base, MAIL_MODE: "brevo", BREVO_API_KEY: "k" }, impl).sendMagicLink("ada@example.com", LINK);
    expect(calls).toHaveLength(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("sends nothing by default, and never calls the network in console mode", async () => {
    const { impl, calls } = fakeFetch(201);
    await mailerFor(base, impl).sendMagicLink("ada@example.com", LINK);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await mailerFor({ ...base, MAIL_MODE: "console" }, impl).sendMagicLink("ada@example.com", LINK);
    log.mockRestore();
    expect(calls).toHaveLength(0);
  });
});
