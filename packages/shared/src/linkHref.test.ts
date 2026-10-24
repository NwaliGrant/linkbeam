import { describe, expect, it } from "vitest";
import { linkHref } from "./linkHref";

describe("linkHref", () => {
  it("keeps normal web addresses", () => {
    expect(linkHref("url", "https://example.com/a")).toBe("https://example.com/a");
    expect(linkHref("coffee", "https://buymeacoffee.com/your-name")).toBe("https://buymeacoffee.com/your-name");
    expect(linkHref("map", "https://maps.google.com/?q=1")).toBe("https://maps.google.com/?q=1");
  });
  it("builds WhatsApp, phone and email addresses", () => {
    expect(linkHref("whatsapp", "+2348012345678")).toBe("https://wa.me/2348012345678");
    expect(linkHref("whatsapp", "+2348012345678", "Hello there & hi")).toBe("https://wa.me/2348012345678?text=Hello%20there%20%26%20hi");
    expect(linkHref("call", "+2348012345678")).toBe("tel:+2348012345678");
    expect(linkHref("email", "A@Example.com")).toBe("mailto:a@example.com");
  });
  it("ignores a blank message", () => {
    expect(linkHref("whatsapp", "+2348012345678", "   ")).toBe("https://wa.me/2348012345678");
  });
  it("refuses dangerous or wrong targets", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "java\tscript:alert(1)"]) {
      expect(linkHref("url", bad)).toBeNull();
    }
    expect(linkHref("call", "https://example.com")).toBeNull();
    expect(linkHref("whatsapp", "0801")).toBeNull();
    expect(linkHref("email", "not-an-email")).toBeNull();
  });
});
