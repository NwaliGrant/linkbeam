import { describe, expect, it } from "vitest";
import {
  MAX_URL_LENGTH,
  checkUsername,
  isPlainText,
  isPermutation,
  isValidAccent,
  normalizeEmail,
  normalizePhone,
  normalizeTarget,
  normalizeWebUrl,
} from "./validators";

describe("checkUsername", () => {
  it("lowercases and trims valid names", () => {
    expect(checkUsername("  Grant_01 ")).toEqual({ ok: true, username: "grant_01" });
  });

  it.each(["ab", "a".repeat(31), "has space", "dot.name", "émile", "bad!", ""])("rejects %j", (name) => {
    expect(checkUsername(name).ok).toBe(false);
  });

  it.each(["admin", "API", "Login", "linkbeam", "u"])("blocks the reserved word %j", (name) => {
    const result = checkUsername(name);
    expect(result.ok).toBe(false);
  });

  it("accepts the length limits exactly", () => {
    expect(checkUsername("abc").ok).toBe(true);
    expect(checkUsername("a".repeat(30)).ok).toBe(true);
  });
});

describe("normalizeWebUrl", () => {
  it("accepts and normalises ordinary web addresses", () => {
    expect(normalizeWebUrl("https://Example.com/path?x=1")).toBe("https://example.com/path?x=1");
    expect(normalizeWebUrl("HTTP://example.com")).toBe("http://example.com/");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "//example.com",
    "example.com",
    "https:example.com",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "https://exa mple.com",
    "https://example.com/\u0000",
    "https://example.com/​",
    "https://user:pass@example.com",
    "https://localhost/",
    "https://example.com\\@evil.com",
    "",
  ])("rejects %j", (value) => {
    expect(normalizeWebUrl(value)).toBeNull();
  });

  it("rejects very long addresses", () => {
    expect(normalizeWebUrl(`https://example.com/${"a".repeat(MAX_URL_LENGTH)}`)).toBeNull();
  });

  it("turns lookalike unicode hosts into visible punycode instead of passing them through", () => {
    const result = normalizeWebUrl("https://exаmple.com/");
    expect(result).toContain("xn--");
  });

  it("is idempotent", () => {
    const once = normalizeWebUrl("https://Example.com/a b".replace(" ", "%20"));
    expect(once).not.toBeNull();
    expect(normalizeWebUrl(once as string)).toBe(once);
  });
});

describe("normalizeEmail and normalizePhone", () => {
  it("normalises email case and rejects malformed addresses", () => {
    expect(normalizeEmail(" Grant@Example.COM ")).toBe("grant@example.com");
    for (const bad of ["no-at.com", "a@b", "a b@c.com", "a@@c.com", "<x>@c.com", `${"a".repeat(250)}@c.com`]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("accepts international numbers and strips formatting", () => {
    expect(normalizePhone("+234 801 234 5678")).toBe("+2348012345678");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
  });

  it.each(["08012345678", "+0123456789", "+12", "+1234567890123456", "tel:+2348012345678", "+234abc"])(
    "rejects phone %j",
    (value) => {
      expect(normalizePhone(value)).toBeNull();
    },
  );
});

describe("normalizeTarget", () => {
  it("applies the right rule for each kind", () => {
    expect(normalizeTarget("url", "https://example.com")).toBe("https://example.com/");
    expect(normalizeTarget("coffee", "https://buymeacoffee.com/your-name")).toBe("https://buymeacoffee.com/your-name");
    expect(normalizeTarget("map", "https://maps.google.com/?q=Lagos")).toBe("https://maps.google.com/?q=Lagos");
    expect(normalizeTarget("whatsapp", "+2348012345678")).toBe("+2348012345678");
    expect(normalizeTarget("call", "+2348012345678")).toBe("+2348012345678");
    expect(normalizeTarget("email", "Hi@Example.com")).toBe("hi@example.com");
  });

  it("does not let a value valid for one kind pass as another", () => {
    expect(normalizeTarget("whatsapp", "https://example.com")).toBeNull();
    expect(normalizeTarget("email", "+2348012345678")).toBeNull();
    expect(normalizeTarget("url", "+2348012345678")).toBeNull();
    expect(normalizeTarget("coffee", "javascript:alert(1)")).toBeNull();
  });
});

describe("isValidAccent", () => {
  it("accepts only six-digit hex colours", () => {
    expect(isValidAccent("#0B6B3A")).toBe(true);
    expect(isValidAccent("#0b6b3a")).toBe(true);
    for (const bad of ["0B6B3A", "#0B6", "#GGGGGG", "red", "#0B6B3A; color: red"]) {
      expect(isValidAccent(bad)).toBe(false);
    }
  });
});

describe("isPermutation", () => {
  it("accepts any reordering of the same ids", () => {
    expect(isPermutation(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
    expect(isPermutation([], [])).toBe(true);
  });

  it("rejects missing, extra, duplicate and foreign ids", () => {
    expect(isPermutation(["a", "b"], ["a"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "a"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "x"])).toBe(false);
  });
});

describe("look-alike usernames and hidden text (red team SL-003, SL-004)", () => {
  it.each(["adm1n", "admln", "ad-min", "ad_min", "4dmin", "l1nkbeam", "linkbearn", "supp0rt", "off1cial", "securlty", "r00t"])("refuses the look-alike %s", (name) => {
    expect(checkUsername(name).ok).toBe(false);
  });
  it.each(["ada-designs", "grant_01", "adminfan", "mysupport", "linkbeamer", "tolu", "ngozi"])("still allows %s", (name) => {
    expect(checkUsername(name).ok).toBe(true);
  });
  it("hidden and direction-changing characters are not plain text, but accents, emoji and joiners are", () => {
    for (const bad of ["Ada‮evil", "Ada⁦x⁩", "Ada​Obi", "Ada\u0000Obi", "Ada\u0007Obi", "Ada Obi", "Ada­Obi", "A﻿da", "Ada؜Obi"]) {
      expect(isPlainText(bad, true), JSON.stringify(bad)).toBe(false);
    }
    for (const good of ["Ọlá Adéwálé", "Ada 🌍", "👨‍👩‍👧 family", "نام‌نمونه"]) expect(isPlainText(good), good).toBe(true);
    expect(isPlainText("two\nlines")).toBe(false);
    expect(isPlainText("two\nlines", true)).toBe(true);
  });
});
