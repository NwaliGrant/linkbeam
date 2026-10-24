/**
 * Avatar sanitiser. It decides the type from the file's own bytes (never from the filename or
 * the client's content type), rebuilds the file from known-safe parts only, and drops everything
 * else: EXIF/XMP/ICC metadata, comments, animation, and any bytes after the end of the image.
 * It does not resize or re-compress. See docs/DECISIONS.md D-012.
 */

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export interface CleanImage {
  contentType: ImageType;
  bytes: Uint8Array;
}

export const MAX_AVATAR_BYTES = 1_048_576;
export const MAX_AVATAR_SIDE = 4096;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function sizeOk(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_AVATAR_SIDE && height <= MAX_AVATAR_SIDE;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

// ---------------------------------------------------------------- JPEG

function sanitizeJpeg(input: Uint8Array): Uint8Array | null {
  if (input[0] !== 0xff || input[1] !== 0xd8 || input[2] !== 0xff) return null;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let position = 2;
  let sawFrame = false;
  let sawScan = false;

  while (position < input.length) {
    if (input[position] !== 0xff) return null;
    while (input[position + 1] === 0xff) position += 1;
    const marker = input[position + 1];
    if (marker === undefined) return null;

    if (marker === 0xd9) {
      parts.push(input.subarray(position, position + 2));
      return sawFrame && sawScan ? concat(parts) : null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(input.subarray(position, position + 2));
      position += 2;
      continue;
    }

    const length = ((input[position + 2] ?? 0) << 8) | (input[position + 3] ?? 0);
    if (length < 2 || position + 2 + length > input.length) return null;
    const segment = input.subarray(position, position + 2 + length);

    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = ((segment[5] ?? 0) << 8) | (segment[6] ?? 0);
      const width = ((segment[7] ?? 0) << 8) | (segment[8] ?? 0);
      if (!sizeOk(width, height)) return null;
      sawFrame = true;
    }

    const isDroppedMetadata = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!isDroppedMetadata) parts.push(segment);
    position += 2 + length;

    if (marker === 0xda) {
      sawScan = true;
      let end = position;
      while (end < input.length) {
        if (input[end] === 0xff) {
          const next = input[end + 1];
          if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
            end += 2;
            continue;
          }
          if (next === 0xff) {
            end += 1;
            continue;
          }
          break;
        }
        end += 1;
      }
      parts.push(input.subarray(position, end));
      position = end;
    }
  }
  return null;
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

function sanitizePng(input: Uint8Array): Uint8Array | null {
  if (PNG_SIGNATURE.some((byte, index) => input[index] !== byte)) return null;
  const parts: Uint8Array[] = [input.subarray(0, 8)];
  let position = 8;
  let first = true;
  let sawData = false;

  while (position + 12 <= input.length) {
    const length = readUint32BE(input, position);
    const end = position + 12 + length;
    if (end > input.length) return null;
    const type = ascii(input, position + 4, 4);
    const body = input.subarray(position + 4, position + 8 + length);
    if (crc32(body) !== readUint32BE(input, position + 8 + length)) return null;

    if (first) {
      if (type !== "IHDR" || length !== 13) return null;
      if (!sizeOk(readUint32BE(input, position + 8), readUint32BE(input, position + 12))) return null;
      first = false;
    }
    if (type === "IDAT") sawData = true;
    if (PNG_KEEP.has(type)) parts.push(input.subarray(position, end));
    position = end;
    if (type === "IEND") return sawData ? concat(parts) : null;
  }
  return null;
}

// ---------------------------------------------------------------- WebP

function sanitizeWebp(input: Uint8Array): Uint8Array | null {
  if (ascii(input, 0, 4) !== "RIFF" || ascii(input, 8, 4) !== "WEBP") return null;
  if (readUint32LE(input, 4) + 8 > input.length) return null;
  const riffEnd = readUint32LE(input, 4) + 8;

  const kept: Uint8Array[] = [];
  let hasImage = false;
  let position = 12;

  while (position + 8 <= riffEnd) {
    const type = ascii(input, position, 4);
    const size = readUint32LE(input, position + 4);
    const padded = size + (size % 2);
    if (position + 8 + padded > riffEnd) return null;
    const data = input.subarray(position + 8, position + 8 + size);
    const whole = input.subarray(position, position + 8 + padded);

    if (type === "VP8X") {
      if (size < 10) return null;
      const flags = data[0] ?? 0;
      if (flags & 0x02) return null; // animated
      const width = ((data[4] ?? 0) | ((data[5] ?? 0) << 8) | ((data[6] ?? 0) << 16)) + 1;
      const height = ((data[7] ?? 0) | ((data[8] ?? 0) << 8) | ((data[9] ?? 0) << 16)) + 1;
      if (!sizeOk(width, height)) return null;
      const copy = new Uint8Array(whole);
      copy[8] = flags & ~(0x20 | 0x08 | 0x04); // clear ICC, EXIF and XMP flags
      kept.push(copy);
    } else if (type === "VP8 ") {
      if (size < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null;
      const width = ((data[6] ?? 0) | ((data[7] ?? 0) << 8)) & 0x3fff;
      const height = ((data[8] ?? 0) | ((data[9] ?? 0) << 8)) & 0x3fff;
      if (!sizeOk(width, height)) return null;
      kept.push(whole);
      hasImage = true;
    } else if (type === "VP8L") {
      if (size < 5 || data[0] !== 0x2f) return null;
      const width = ((data[1] ?? 0) | (((data[2] ?? 0) & 0x3f) << 8)) + 1;
      const height = (((data[2] ?? 0) >> 6) | ((data[3] ?? 0) << 2) | (((data[4] ?? 0) & 0x0f) << 10)) + 1;
      if (!sizeOk(width, height)) return null;
      kept.push(whole);
      hasImage = true;
    } else if (type === "ALPH") {
      kept.push(whole);
    }
    position += 8 + padded;
  }

  if (!hasImage) return null;
  const bodyLength = 4 + kept.reduce((sum, part) => sum + part.length, 0);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(header.buffer).setUint32(4, bodyLength, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8);
  return concat([header, ...kept]);
}

// ---------------------------------------------------------------- entry point

export function sanitizeImage(input: Uint8Array): CleanImage | null {
  if (input.length === 0 || input.length > MAX_AVATAR_BYTES) return null;
  const jpeg = sanitizeJpeg(input);
  if (jpeg) return { contentType: "image/jpeg", bytes: jpeg };
  const png = sanitizePng(input);
  if (png) return { contentType: "image/png", bytes: png };
  const webp = sanitizeWebp(input);
  if (webp) return { contentType: "image/webp", bytes: webp };
  return null;
}
