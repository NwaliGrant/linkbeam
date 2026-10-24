import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES, sanitizeImage } from "../src/image";
import { SECRET, concatBytes, contains, decodes, insertPngChunk, makeImage, pngChunk, text } from "./images";

describe("sanitizeImage: JPEG", () => {
  it("removes EXIF and trailing bytes but keeps a valid picture", async () => {
    const original = await makeImage("jpeg", { withExif: true });
    expect(contains(original, SECRET)).toBe(true);

    const polyglot = concatBytes(original, text("<script>alert(1)</script>"));
    const clean = sanitizeImage(polyglot);
    expect(clean?.contentType).toBe("image/jpeg");
    expect(contains(clean?.bytes ?? new Uint8Array(), SECRET)).toBe(false);
    expect(contains(clean?.bytes ?? new Uint8Array(), "<script>")).toBe(false);
    expect(await decodes(clean?.bytes ?? new Uint8Array())).toEqual({ width: 32, height: 32, exif: false });
  });

  it("drops comment segments", async () => {
    const original = await makeImage("jpeg");
    const comment = concatBytes(new Uint8Array([0xff, 0xfe, 0x00, 0x10]), text("hidden-comment"));
    const withComment = concatBytes(original.subarray(0, 2), comment, original.subarray(2));
    expect(contains(withComment, "hidden-comment")).toBe(true);
    const clean = sanitizeImage(withComment);
    expect(contains(clean?.bytes ?? new Uint8Array(), "hidden-comment")).toBe(false);
    await decodes(clean?.bytes ?? new Uint8Array());
  });

  it("rejects a truncated file", async () => {
    const original = await makeImage("jpeg");
    expect(sanitizeImage(original.subarray(0, original.length - 20))).toBeNull();
  });
});

describe("sanitizeImage: PNG", () => {
  it("removes EXIF, text chunks and trailing bytes but keeps a valid picture", async () => {
    const original = await makeImage("png", { withExif: true });
    const withText = insertPngChunk(original, pngChunk("tEXt", text("Comment\0hidden-text")));
    const polyglot = concatBytes(withText, text("<script>alert(1)</script>"));
    expect(contains(polyglot, "hidden-text")).toBe(true);

    const clean = sanitizeImage(polyglot);
    expect(clean?.contentType).toBe("image/png");
    const bytes = clean?.bytes ?? new Uint8Array();
    expect(contains(bytes, SECRET)).toBe(false);
    expect(contains(bytes, "hidden-text")).toBe(false);
    expect(contains(bytes, "<script>")).toBe(false);
    expect(await decodes(bytes)).toEqual({ width: 32, height: 32, exif: false });
  });

  it("rejects a chunk with a bad checksum", async () => {
    const png = await makeImage("png");
    const damaged = new Uint8Array(png);
    damaged[40] = (damaged[40] ?? 0) ^ 0xff;
    expect(sanitizeImage(damaged)).toBeNull();
  });
});

describe("sanitizeImage: WebP", () => {
  it("removes EXIF and keeps a valid picture", async () => {
    const original = await makeImage("webp", { withExif: true });
    expect(contains(original, SECRET)).toBe(true);
    const clean = sanitizeImage(concatBytes(original));
    expect(clean?.contentType).toBe("image/webp");
    const bytes = clean?.bytes ?? new Uint8Array();
    expect(contains(bytes, SECRET)).toBe(false);
    expect(await decodes(bytes)).toEqual({ width: 32, height: 32, exif: false });
  });

  it("rejects animated files", async () => {
    const original = new Uint8Array(await makeImage("webp", { withExif: true }));
    expect(String.fromCharCode(...original.subarray(12, 16))).toBe("VP8X");
    original[20] = (original[20] ?? 0) | 0x02;
    expect(sanitizeImage(original)).toBeNull();
  });
});

describe("sanitizeImage: things that are not safe photos", () => {
  it.each([
    ["SVG with script", text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", text("<html><script>alert(1)</script></html>")],
    ["plain text", text("hello")],
    ["empty file", new Uint8Array()],
    ["zip header", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
    ["GIF", text("GIF89a")],
  ])("rejects %s", (_name, bytes) => {
    expect(sanitizeImage(bytes)).toBeNull();
  });

  it("rejects files over 1 MB", async () => {
    const original = await makeImage("jpeg");
    const padded = concatBytes(original, new Uint8Array(MAX_AVATAR_BYTES));
    expect(sanitizeImage(padded)).toBeNull();
  });

  it.each(["jpeg", "png", "webp"] as const)("rejects a %s that is wider and taller than 4096 pixels", async (format) => {
    const huge = await makeImage(format, { size: 5000 });
    expect(huge.length).toBeLessThan(MAX_AVATAR_BYTES);
    expect(sanitizeImage(huge)).toBeNull();
  });
});
