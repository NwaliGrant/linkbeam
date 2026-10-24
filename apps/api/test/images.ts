import { crc32 } from "node:zlib";
import sharp from "sharp";

export type Format = "jpeg" | "png" | "webp";
export const SECRET = "secret-owner-name";

export async function makeImage(format: Format, options: { size?: number; withExif?: boolean } = {}): Promise<Uint8Array> {
  const size = options.size ?? 32;
  let pipeline = sharp({ create: { width: size, height: size, channels: 3, background: "#0B6B3A" } });
  if (options.withExif) pipeline = pipeline.withExif({ IFD0: { Copyright: SECRET } });
  const buffer = await pipeline[format]().toBuffer();
  return new Uint8Array(buffer);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const text = (value: string): Uint8Array => new TextEncoder().encode(value);

export function contains(haystack: Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle));
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concatBytes(text(type), data);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** Insert a chunk right after the 8-byte signature and the 25-byte IHDR chunk. */
export function insertPngChunk(png: Uint8Array, chunk: Uint8Array): Uint8Array {
  return concatBytes(png.subarray(0, 33), chunk, png.subarray(33));
}

export async function decodes(bytes: Uint8Array): Promise<{ width: number; height: number; exif: boolean }> {
  const { data, info } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
  if (data.length === 0) throw new Error("empty image");
  const metadata = await sharp(Buffer.from(bytes)).metadata();
  return { width: info.width, height: info.height, exif: metadata.exif !== undefined };
}
