import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLink, authed, createHarness, json, rowCount, type Harness, type TestUser } from "./helpers";
import { concatBytes, makeImage, text } from "./images";

// Red team, checklist rows 4, 5, 6, 9, 10 and 12 (script injection, dangerous addresses, SQL, uploads, overload, headers).

let h: Harness;
let a: TestUser;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});
beforeEach(async () => {
  await h.reset();
  a = await h.createUser({ username: "alice" });
});

const send = (method: string, path: string, body: unknown, as: TestUser = a) => h.request(path, json(body, as.cookie, method));
const page = async (name = "alice") => (await h.request(`/u/${name}`)).text();

const XSS = [
  `<script>alert(1)</script>`,
  `"><script>alert(1)</script>`,
  `'><img src=x onerror=alert(1)>`,
  `<svg onload=alert(1)>`,
  `</title><script>alert(1)</script>`,
  `</style><script>alert(1)</script>`,
  `<iframe src="javascript:alert(1)">`,
  `" onmouseover="alert(1)`,
  `' onfocus='alert(1)' autofocus='`,
  "`${alert(1)}`",
  `<a href="javascript:alert(1)">x</a>`,
  `{{constructor.constructor('alert(1)')()}}`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
  `&lt;script&gt;alert(1)&lt;/script&gt;`,
];

describe("row 4: script injection (stored and reflected)", () => {
  it.each(XSS)("payload %# in every owner text field never becomes markup on the public page", async (payload) => {
    await send("PATCH", "/api/v1/me", { display_name: payload.slice(0, 60), bio: payload.slice(0, 160) });
    await send("POST", "/api/v1/links", { title: payload.slice(0, 60), target: "https://example.com/a" });
    await send("POST", "/api/v1/links", { kind: "whatsapp", title: "Chat", target: "+2348012345678", message: payload });
    const body = await page();
    // Exactly one script (ours), and nothing the attacker typed is left as a tag or attribute.
    expect(body.match(/<script/gi)).toHaveLength(1);
    expect(body).not.toMatch(/<(img|svg|iframe|math|a)\b[^>]*\bon\w+=/i);
    expect(body).not.toContain("<img src=x");
    expect(body).not.toContain("<svg onload");
    expect(body).not.toContain("<iframe");
    expect(body).not.toMatch(/\shref="javascript:/i);
    // No attribute was broken out of: every double quote typed by the attacker is escaped.
    if (payload.includes('"')) expect(body).toContain("&quot;");
  });

  it("the page's policy allows only our one script and blocks everything else", async () => {
    const response = await h.request("/u/alice");
    await send("PATCH", "/api/v1/me", { display_name: "x" });
    const csp = (await h.request("/u/alice")).headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    // Styles are allowed by hash: the hash must be exactly that of the style block the page was sent with.
    const html = await (await h.request("/u/alice")).text();
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css))).toString("base64");
    expect(csp).toContain(`style-src 'sha256-${digest}'`);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toMatch(/\sstyle="/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.status).toBeLessThan(500);
  });

  it("reflected: hostile names in the path, query and headers are never echoed back as markup", async () => {
    for (const path of ["/u/%3Cscript%3Ealert(1)%3C%2Fscript%3E", "/u/alice?x=%3Cscript%3Ealert(1)%3C/script%3E&name=%22%3E%3Cimg%20src=x%3E", "/u/%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E"]) {
      const response = await h.request(path, { headers: { "user-agent": "<script>alert(1)</script>", referer: "https://x.test/<script>", "accept-language": "<script>" }, redirect: "manual" });
      const body = await response.text();
      expect(body, path).not.toContain("<script>alert(1)");
      expect(body, path).not.toContain("<img src=x");
    }
  });

  it("reflected in API errors: the typed value is never echoed, and errors are JSON with nosniff", async () => {
    const attack = "<script>alert(1)</script>";
    const responses = [
      await send("POST", "/api/v1/links", { kind: attack, title: "x", target: "https://example.com" }),
      await send("PATCH", "/api/v1/me", { theme: attack }),
      await h.request(`/api/v1/me/stats?days=${encodeURIComponent(attack)}`, authed(a.cookie)),
      await h.request(`/api/v1/links/${encodeURIComponent(attack)}`, { method: "DELETE", headers: { cookie: a.cookie } }),
      await h.request(`/api/v1/u/${encodeURIComponent(attack)}`),
    ];
    for (const response of responses) {
      const body = await response.text();
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(body).not.toContain("<script>");
    }
  });

  it("a script-like report reason is stored as text and never shown to the public", async () => {
    await h.request("/api/v1/report", json({ page: "alice", reason: "<script>alert(1)</script>", turnstile_token: "ok" }));
    expect(await rowCount(h, "reports")).toBe(1);
    expect(await page()).not.toContain("alert(1)");
    expect(await (await h.request("/api/v1/u/alice")).text()).not.toContain("alert(1)");
  });
});

const BAD_ADDRESSES = [
  "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "\tjavascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "java\rscript:alert(1)",
  "\u0001javascript:alert(1)", " javascript:alert(1)", " javascript:alert(1)", "javascript​:alert(1)", "&#106;avascript:alert(1)", "javascript&colon;alert(1)", "javascript%3Aalert(1)",
  "ｊａｖａｓｃｒｉｐｔ:alert(1)", "jаvascript:alert(1)", "data:text/html,<script>alert(1)</script>", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "vbscript:msgbox(1)", "file:///etc/passwd", "ftp://example.com/x", "blob:https://example.com/x", "about:blank", "chrome://settings", "view-source:https://example.com",
  "//evil.example/x", "\\\\evil.example\\x", "/\\evil.example", "https:evil.example", "https:/evil.example", "http://", "https://", "https:// example.com", "https://exa mple.com",
  "https://example.com/\u0000", "https://example.com/<script>", "https://example.com/\"onmouseover=\"alert(1)", `https://example.com/'><script>alert(1)</script>`,
  "https://" + "a".repeat(2100) + ".com", "https://example.com/" + "a".repeat(2100),
  "https://[::1]/", "https://0x7f.0.0.1/", "https://localhost/", "tel:+2348012345678", "mailto:a@b.co", "sms:+2348012345678",
];

describe("row 5: dangerous address schemes, at save and at render", () => {
  it.each(["url", "map", "coffee"] as const)("a %s link refuses every dangerous address, or if it keeps one, it is a plain https/http link", async (kind) => {
    for (const target of BAD_ADDRESSES) {
      const response = await send("POST", "/api/v1/links", { kind, title: "Attack", target });
      if (response.status === 201) {
        const saved = (await response.json()) as { target: string };
        // Only a web address may survive; nothing with another scheme or a stray quote, angle bracket or space.
        // eslint-disable-next-line no-control-regex -- the test checks that no control character survives in a saved address
        expect(saved.target, JSON.stringify(target)).toMatch(/^https?:\/\/[^\s"<>\\\u0000-\u001f]+$/);
      } else {
        expect(response.status, JSON.stringify(target)).toBe(400);
      }
    }
    const body = await page();
    const hrefs = [...body.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? "").filter((href) => !href.startsWith("/"));
    for (const href of hrefs) expect(href, href).toMatch(/^https?:\/\/[^\s<>]+$/);
    expect(body).not.toMatch(/href="(javascript|data|vbscript|file|blob):/i);
  });

  it("phone, WhatsApp and email buttons refuse web addresses and scripts, so they can only open wa.me, tel: and mailto:", async () => {
    for (const kind of ["whatsapp", "call"] as const) {
      for (const target of BAD_ADDRESSES) expect((await send("POST", "/api/v1/links", { kind, title: "x", target })).status, `${kind} ${JSON.stringify(target)}`).toBe(400);
    }
    for (const target of BAD_ADDRESSES.filter((value) => !value.includes("@"))) expect((await send("POST", "/api/v1/links", { kind: "email", title: "x", target })).status, `email ${JSON.stringify(target)}`).toBe(400);
  });

  it("a damaged row written straight into the database still cannot make a dangerous link (render-time check)", async () => {
    let position = 10;
    for (const kind of ["url", "map", "coffee", "whatsapp", "call", "email"]) {
      for (const target of ["javascript:alert(1)", "data:text/html,x", "  javascript:alert(1)", "https://x.com/\"><script>alert(9)</script>"]) {
        await h.db.prepare("INSERT INTO links (id, user_id, kind, title, target, position) VALUES (?1, ?2, ?3, 'Bad', ?4, ?5)").bind(`bad${position}xxxxxxxxxxx`, a.id, kind, target, position++).run();
      }
    }
    const body = await page();
    expect(body).not.toMatch(/href="(javascript|data|vbscript):/i);
    // Whatever was kept is a harmless, percent-encoded web address; nothing became markup.
    expect(body).not.toContain("<script>alert(9)");
    expect(body.match(/<script/g)).toHaveLength(1);
  });
});

describe("row 6: SQL injection", () => {
  const SQLI = [
    "' OR '1'='1", "' OR 1=1--", `" OR ""="`, "'; DROP TABLE users;--", "'; DELETE FROM links;--", "' UNION SELECT email,id,1,1,1,1 FROM users--", "1; SELECT sqlite_version()",
    "' AND (SELECT COUNT(*) FROM users) > 0--", "\\'; --", "%27%20OR%201=1", "') OR ('a'='a", "x' || (SELECT email FROM users LIMIT 1) || '", "'; PRAGMA foreign_keys=OFF;--", "1' AND randomblob(1000000000)--",
  ];

  it("payloads in every text field are stored and returned exactly as typed, and change nothing else", async () => {
    const victim = await h.createUser({ username: "victim" });
    await addLink(h, victim, { title: "Victim link" });
    const users = await rowCount(h, "users");
    const links = await rowCount(h, "links");
    for (const payload of SQLI) {
      const profile = await send("PATCH", "/api/v1/me", { display_name: payload.slice(0, 60), bio: payload.slice(0, 160) });
      expect(profile.status, payload).toBe(200);
      expect(((await profile.json()) as { display_name: string }).display_name).toBe(payload.slice(0, 60).trim());
      const link = await send("POST", "/api/v1/links", { title: payload.slice(0, 60), target: "https://example.com/?q=" + encodeURIComponent(payload) });
      expect(link.status, payload).toBe(201);
      expect(((await link.json()) as { title: string }).title).toBe(payload.slice(0, 60).trim());
      const report = await h.request("/api/v1/report", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${SQLI.indexOf(payload) + 1}` }, body: JSON.stringify({ page: "alice", reason: payload.slice(0, 500), turnstile_token: "ok" }) });
      expect(report.status, payload).toBe(202);
      expect((await h.request("/api/v1/track", json({ page: payload.slice(0, 40) }))).status).toBeLessThan(500);
    }
    expect(await rowCount(h, "users")).toBe(users);
    expect(await rowCount(h, "links", `user_id = '${victim.id}'`)).toBe(links);
    // The text came back out of the database unchanged and was not run as SQL.
    expect(await rowCount(h, "links", `user_id = '${a.id}'`)).toBe(SQLI.length);
    expect(await rowCount(h, "reports")).toBe(SQLI.length);
  });

  it("payloads in paths, ids and query parameters never cause a server error or a different answer", async () => {
    const real = await addLink(h, a);
    for (const payload of SQLI) {
      const enc = encodeURIComponent(payload);
      const results = await Promise.all([
        h.request(`/api/v1/u/${enc}`),
        h.request(`/u/${enc}`),
        h.request(`/api/v1/avatar/${enc}`),
        h.request(`/api/v1/links/${enc}`, { method: "DELETE", headers: { cookie: a.cookie } }),
        h.request(`/api/v1/me/stats?days=${enc}`, authed(a.cookie)),
        h.request(`/api/v1/auth/callback?token=${enc}`, { redirect: "manual" }),
      ]);
      for (const response of results) expect(response.status, payload).toBeLessThan(500);
      expect(results[0]?.status).toBe(404);
      expect(results[3]?.status).toBe(400 === results[3]?.status ? 400 : 404);
    }
    expect(await rowCount(h, "links", `id = '${real.id}'`)).toBe(1);
  });

  it("an email with SQL in it is refused as an email, not run", async () => {
    for (const email of ["a'; DROP TABLE users;--@example.com", "' OR 1=1--@example.com", "a@b.co' OR '1'='1"]) {
      const response = await h.request("/api/v1/auth/magic-link", json({ email, turnstile_token: "ok" }));
      expect([202, 400]).toContain(response.status);
    }
    expect(await rowCount(h, "users")).toBe(1);
  });
});

describe("row 9: file upload attacks", () => {
  const upload = (bytes: Uint8Array, name = "photo.png", type = "image/png", as: TestUser = a) => {
    const form = new FormData();
    form.set("file", new File([bytes], name, { type }));
    return h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: as.cookie }, body: form });
  };

  it("SVG with script, HTML and text are refused whatever name or type they claim", async () => {
    const svg = text(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>`);
    for (const [name, type] of [["a.svg", "image/svg+xml"], ["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.html", "text/html"], ["a.png", "application/octet-stream"]] as const) {
      expect((await upload(svg, name, type)).status, `${name} ${type}`).toBe(400);
      expect((await upload(text("<html><script>alert(1)</script></html>"), name, type)).status).toBe(400);
    }
    expect(await rowCount(h, "avatars")).toBe(0);
  });

  it("a real picture with a script appended (polyglot) is saved clean: the script bytes are gone", async () => {
    const png = await makeImage("png");
    const jpeg = await makeImage("jpeg");
    for (const [image, type] of [[png, "image/png"], [jpeg, "image/jpeg"]] as const) {
      const response = await upload(concatBytes(image, text(`<script>alert("polyglot")</script>GIF89a`)), "pic", type);
      if (response.status === 201) {
        const { avatar_url } = (await response.json()) as { avatar_url: string };
        const served = await h.request(avatar_url);
        const bytes = Buffer.from(await served.arrayBuffer());
        expect(bytes.includes(Buffer.from("<script>"))).toBe(false);
        expect(bytes.includes(Buffer.from("polyglot"))).toBe(false);
        expect(served.headers.get("x-content-type-options")).toBe("nosniff");
        expect(served.headers.get("content-security-policy")).toContain("sandbox");
        expect(served.headers.get("content-type")).toMatch(/^image\/(png|jpeg)$/);
      } else {
        expect(response.status).toBe(400);
      }
    }
  });

  it("other formats and oddities are refused: GIF, BMP, ICO, PDF, zip, empty file, one byte", async () => {
    const cases: Array<[string, Uint8Array]> = [
      ["gif", text("GIF89a\u0001\u0000\u0001\u0000")], ["bmp", text("BM" + "\u0000".repeat(60))], ["ico", Uint8Array.from([0, 0, 1, 0, 1, 0])],
      ["pdf", text("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj")], ["zip", Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 0])], ["empty", new Uint8Array(0)], ["one byte", Uint8Array.from([0xff])],
    ];
    for (const [label, bytes] of cases) expect((await upload(bytes, "x.png")).status, label).toBe(400);
  });

  it("a tiny file that claims a huge picture (decompression bomb) is refused without being decoded", async () => {
    const bomb = await makeImage("png", { size: 8 });
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    // Rewrite the width and height in the PNG header to 60000 x 60000 (3.6 billion pixels). The checksum then fails, so
    // it is refused either way; the point is that no decoder ever allocates for it.
    view.setUint32(16, 60000);
    view.setUint32(20, 60000);
    const started = Date.now();
    expect((await upload(bomb)).status).toBe(400);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("path-traversal and hostile file names are never used: the picture is stored under a random key", async () => {
    const png = await makeImage("png");
    for (const name of ["../../etc/passwd.png", "..\\..\\windows\\system32\\x.png", "a/b/c.png", "x\u0000.png", "<script>.png", "a".repeat(5000) + ".png", "CON.png"]) {
      const response = await upload(png, name);
      expect(response.status, name).toBe(201);
      const { avatar_url } = (await response.json()) as { avatar_url: string };
      expect(avatar_url).toMatch(/^\/api\/v1\/avatar\/[A-Za-z0-9_-]{16,}$/);
      expect(avatar_url).not.toContain("passwd");
    }
    expect(await rowCount(h, "avatars", `user_id = '${a.id}'`)).toBe(1);
  });

  it("oversized uploads are stopped by size before they are read, with a lying length header or no header", async () => {
    const big = new Uint8Array(3_000_000);
    expect((await upload(big)).status).toBe(413);
    const form = new FormData();
    form.set("file", new File([big], "a.png", { type: "image/png" }));
    const lying = await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: a.cookie, "content-length": "100" }, body: form });
    expect(lying.status).toBeGreaterThanOrEqual(400);
    expect(lying.status).toBeLessThan(500);
  });

  it("many parts, a missing file and a text field in place of the file are refused with a friendly error", async () => {
    const form = new FormData();
    for (let index = 0; index < 200; index++) form.append(`f${index}`, "x");
    expect((await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: a.cookie }, body: form })).status).toBe(400);
    const text1 = new FormData();
    text1.set("file", "not a file");
    expect((await h.request("/api/v1/me/avatar", { method: "POST", headers: { cookie: a.cookie }, body: text1 })).status).toBe(400);
  });
});

describe("row 10: overload and denial of service", () => {
  it("bodies over 16 KB are refused with 413 on every JSON endpoint, even when no length is declared", async () => {
    const huge = JSON.stringify({ display_name: "x".repeat(20_000) });
    for (const path of ["/api/v1/me", "/api/v1/links", "/api/v1/track", "/api/v1/report", "/api/v1/auth/magic-link"]) {
      const response = await h.request(path, { method: path === "/api/v1/me" ? "PATCH" : "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: huge });
      expect(response.status, path).toBe(413);
    }
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(8192)));
      },
    });
    const response = await h.request("/api/v1/track", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413);
  });

  it("deeply nested JSON, huge numbers, long strings and weird shapes give a clean 400, quickly", async () => {
    const depth = 7000;
    const deep = "[".repeat(depth) + "]".repeat(depth);
    const bodies = [deep, `{"a":`.repeat(2000) + "1" + "}".repeat(2000), '{"title": 1e999}', `{"title": ${"9".repeat(5000)}}`, JSON.stringify([1, 2, 3]), "null", '"text"', "{", '{"title":"x","title":"y"}', JSON.stringify({ title: { $ne: 1 } }), JSON.stringify({ title: ["x"] })];
    const started = Date.now();
    for (const body of bodies) {
      const response = await h.request("/api/v1/links", { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body });
      expect([400, 413], body.slice(0, 30)).toContain(response.status);
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("magic-link, report and sign-up are limited per address: the sixth request in an hour gets 429 with Retry-After", async () => {
    const headers = { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" };
    const link: number[] = [];
    for (let index = 0; index < 8; index++) link.push((await h.request("/api/v1/auth/magic-link", { method: "POST", headers, body: JSON.stringify({ email: `user${index}@example.com`, turnstile_token: "ok" }) })).status);
    expect(link.filter((status) => status === 429).length).toBe(3);
    const report: Response[] = [];
    for (let index = 0; index < 8; index++) report.push(await h.request("/api/v1/report", { method: "POST", headers: { ...headers, "cf-connecting-ip": "203.0.113.51" }, body: JSON.stringify({ page: "alice", reason: "x", turnstile_token: "ok" }) }));
    expect(report.filter((response) => response.status === 429)).toHaveLength(3);
    expect(report.find((response) => response.status === 429)?.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("an unusual method or content type on any route is refused, not crashed", async () => {
    for (const method of ["PUT", "OPTIONS", "PATCH", "DELETE", "POST"]) {
      for (const path of ["/api/v1/health", "/u/alice", "/api/v1/u/alice", "/api/v1/track"]) {
        const response = await h.request(path, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, ...(method === "POST" || method === "PUT" || method === "PATCH" ? { body: "a=b" } : {}) });
        expect(response.status, `${method} ${path}`).toBeLessThan(500);
      }
    }
  });
});

describe("row 12: clickjacking and security headers", () => {
  it("every kind of answer says it cannot be framed, cannot be sniffed, and must use https", async () => {
    await addLink(h, a);
    const paths = ["/u/alice", "/u/nobody-here", "/api/v1/health", "/api/v1/u/alice", "/api/v1/u/nobody", "/api/v1/nothing", "/api/v1/me"];
    for (const path of paths) {
      const response = await h.request(path);
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(response.headers.get("strict-transport-security"), path).toMatch(/max-age=\d{7,}/);
      expect(response.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("x-powered-by"), path).toBeNull();
      expect(response.headers.get("server"), path).toBeNull();
    }
  });

  it("private answers are never cached, and the session cookie is locked down", async () => {
    for (const path of ["/api/v1/me", "/api/v1/links", "/api/v1/me/export", "/api/v1/me/stats"]) {
      expect((await h.request(path, authed(a.cookie))).headers.get("cache-control"), path).toBe("no-store");
    }
    const mail = await h.request("/api/v1/auth/magic-link", json({ email: "cookie@example.com", turnstile_token: "ok" }));
    expect(mail.status).toBe(202);
    const token = new URL(h.mail.at(-1)?.link ?? "https://x.test/").searchParams.get("token") ?? "";
    const signedIn = await h.request(`/api/v1/auth/callback?token=${encodeURIComponent(token)}`, { redirect: "manual" });
    const cookie = signedIn.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-lb_session=/);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(flag);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("email header injection: a line break or second address in the email field sends nothing to anyone else", async () => {
    let ip = 0;
    for (const email of ["a@example.com\r\nBcc: spy@evil.test", "a@example.com\nSubject: hi", "a@example.com,spy@evil.test", "a@example.com;spy@evil.test", "<spy@evil.test>a@example.com", "a@example.com spy@evil.test"]) {
      const response = await h.request("/api/v1/auth/magic-link", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `192.0.2.${++ip}` }, body: JSON.stringify({ email, turnstile_token: "ok" }) });
      expect([202, 400], email).toContain(response.status);
    }
    for (const mail of h.mail) {
      expect(mail.email).toMatch(/^[^\s,;<>]+@[^\s,;<>]+$/);
      expect(mail.email).not.toContain("spy");
    }
  });
});
