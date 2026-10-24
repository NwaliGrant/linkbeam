import { describe, expect, it } from "vitest";
import { createLinkSchema } from "./schemas";
import { LINK_KINDS, normalizeTarget, type LinkKind } from "./validators";
import { linkHref } from "./linkHref";

const ok = (kind: LinkKind, raw: string): string | null => normalizeTarget(kind, raw);

describe("WhatsApp and phone numbers", () => {
  it.each(["whatsapp", "call"] as const)("%s accepts international numbers and tidies them", (kind) => {
    expect(ok(kind, "+2348012345678")).toBe("+2348012345678");
    expect(ok(kind, "+234 801 234 5678")).toBe("+2348012345678");
    expect(ok(kind, "(+234) 801-234-5678")).toBe("+2348012345678");
    expect(ok(kind, "+234.801.234.5678")).toBe("+2348012345678");
    expect(ok(kind, "002348012345678")).toBe("+2348012345678");
    expect(ok(kind, "+14155552671")).toBe("+14155552671");
  });
  it.each(["whatsapp", "call"] as const)("%s refuses local, short, long and odd numbers", (kind) => {
    for (const bad of ["08012345678", "+0801234567", "+234", "+2348012", "+2348012345678901", "++2348012345678", "+234-801-ABC-5678", "+234801234567８", "tel:+2348012345678", "+2348012345678;ext=1", "+234 801 234 5678\n+1", "", "   "]) {
      expect(ok(kind, bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("email buttons", () => {
  it("accepts ordinary addresses and lowercases them", () => {
    expect(ok("email", "Ada.Obi+shop@Example.com")).toBe("ada.obi+shop@example.com");
    expect(ok("email", "a@b.co")).toBe("a@b.co");
  });
  it("refuses anything that could change the mail link", () => {
    for (const bad of [
      "a@b.co?cc=evil@x.com", "a@b.co?subject=hi", "a@b.co&bcc=x@y.zz", "a@b.co#x", "a@b.co,evil@x.com", "a@b.co;evil@x.com",
      "a b@c.co", "a@b", "a@@b.co", "@b.co", "a@.co", "a@b..co", "a@-b.co", "<a@b.co>", "a@b.co\r\nBcc: x@y.zz", "ａ@b.co", "a@b.c", "x".repeat(70) + "@b.co", "",
    ]) {
      expect(ok("email", bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("web, coffee and map addresses", () => {
  it("web links accept http and https", () => {
    expect(ok("url", "https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(ok("url", "http://example.com")).toBe("http://example.com/");
  });
  it("coffee links accept https on Buy Me a Coffee only", () => {
    expect(ok("coffee", "https://buymeacoffee.com/ada")).toBe("https://buymeacoffee.com/ada");
    expect(ok("coffee", "http://buymeacoffee.com/ada")).toBeNull();
    expect(ok("coffee", "https://example.com/ada")).toBeNull();
    expect(ok("coffee", "javascript:alert(1)")).toBeNull();
    expect(ok("coffee", "")).toBeNull();
  });
  it("map takes a web link", () => {
    expect(ok("map", "https://maps.app.goo.gl/abc123")).toBe("https://maps.app.goo.gl/abc123");
    expect(ok("map", "https://www.openstreetmap.org/#map=17/6.5/3.4")).toContain("https://www.openstreetmap.org/");
  });
  it("map turns a plain address into a map search link", () => {
    const href = ok("map", "12 Herbert Macaulay Way, Yaba, Lagos");
    expect(href).toBe("https://www.google.com/maps/search/?api=1&query=12%20Herbert%20Macaulay%20Way%2C%20Yaba%2C%20Lagos");
    expect(ok("map", "Ọjọ́ Ẹtì Street, Ibadan")).toContain("query=%E1%BB%8C");
    expect(ok("map", "  Lekki   Phase 1  ")).toContain("query=Lekki%20Phase%201");
  });
  it("map refuses things that are not addresses", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "tel:+2348012345678", "mailto:a@b.co", "file:///etc/passwd", "ftp://x.com/a", "//evil.com", "Lagos //evil.com", "<b>Lagos</b>", "abc", "!!!!!!!!", "Yaba\u202eLagos", "a".repeat(201), "", "   "]) {
      expect(ok("map", bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("creating a Buy me a coffee link", () => {
  it("accepts only an https page on Buy Me a Coffee", () => {
    for (const good of ["https://buymeacoffee.com/your-name", "https://www.buymeacoffee.com/your-name", "https://coff.ee/your-name"]) {
      expect(createLinkSchema.safeParse({ kind: "coffee", title: "Buy me a coffee", target: good }).success, good).toBe(true);
    }
  });
  it("refuses other sites, http, bare hosts, look-alike hosts and dangerous schemes", () => {
    for (const bad of [
      "http://buymeacoffee.com/your-name", "https://buymeacoffee.com", "https://buymeacoffee.com/", "https://paystack.com/pay/x",
      "https://buymeacoffee.com.evil.com/x", "https://evilbuymeacoffee.com/x", "https://user@evil.com/buymeacoffee.com/x",
      "javascript:alert(1)", "data:text/html,x", "", "   ",
    ]) {
      expect(createLinkSchema.safeParse({ kind: "coffee", title: "Coffee", target: bad }).success, bad).toBe(false);
    }
  });
  it("the old payment kinds and a bank card are no longer accepted", () => {
    expect(createLinkSchema.safeParse({ kind: "pay", title: "Pay me", target: "https://paystack.com/pay/ada" }).success).toBe(false);
    expect(LINK_KINDS).not.toContain("pay");
    // Unknown fields such as "bank" are ignored, never stored.
    const parsed = createLinkSchema.parse({ kind: "url", title: "Site", target: "https://example.com", bank: { account_number: "0123456789" } });
    expect(parsed).not.toHaveProperty("bank");
  });
});

// A simple repeatable "fuzz" test: thousands of nasty strings must never produce a dangerous button address.
function* nastyStrings(count: number): Generator<string> {
  let seed = 123456789;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pieces = [
    "javascript:", "data:", "vbscript:", "file:", "https://", "http://", "//", "+234", "00", "@", "?", "&", "=", "#", "%", "%0a", "%00",
    "\n", "\r", "\t", " ", "\u0000", "\u202e", "\u200b", "<", ">", '"', "'", "\\", "example", ".com", "a", "1", "8012345678", "alert(1)", "Lagos", "ｊａｖａ", "ọ", "tel:", "mailto:", "x@y.zz", "?cc=", "../", ":", ";", ",", "(", ")", "-", ".",
  ];
  for (let index = 0; index < count; index++) {
    const length = 1 + Math.floor(next() * 7);
    let value = "";
    for (let part = 0; part < length; part++) value += pieces[Math.floor(next() * pieces.length)] ?? "";
    yield value;
  }
}

describe("fuzz: no input can produce a dangerous address", () => {
  // eslint-disable-next-line no-control-regex -- matching control characters is the whole purpose of this pattern
  const SAFE_WEB = /^https?:\/\/[^\s\u0000-\u001f<>"\\]+$/;
  const SHAPES: Record<LinkKind, RegExp> = {
    url: SAFE_WEB,
    // eslint-disable-next-line no-control-regex -- matching control characters is the whole purpose of this pattern
    coffee: /^https:\/\/[^\s\u0000-\u001f<>"\\]+$/,
    map: SAFE_WEB,
    whatsapp: /^https:\/\/wa\.me\/[1-9]\d{7,14}(\?text=[A-Za-z0-9%._~!*'()-]*)?$/,
    call: /^tel:\+[1-9]\d{7,14}$/,
    email: /^mailto:[a-z0-9._%+-]+@[a-z0-9.-]+$/,
  };
  it("checks 20,000 strings across every kind", () => {
    let accepted = 0;
    for (const input of nastyStrings(4000)) {
      for (const kind of LINK_KINDS) {
        const href = linkHref(kind, input, input);
        if (href === null) continue;
        accepted++;
        expect(href, `${kind} ${JSON.stringify(input)}`).toMatch(SHAPES[kind]);
        if (kind === "url" || kind === "coffee" || kind === "map") expect(["http:", "https:"]).toContain(new URL(href).protocol);
      }
    }
    // The test must really have accepted some inputs, or it proves nothing.
    expect(accepted).toBeGreaterThan(50);
  });
});
