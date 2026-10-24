export const AVATAR_SIDE = 512;
export const AVATAR_QUALITY = 0.85;

/** Size after scaling so that the longest side is at most `max`. Never scales up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Crops to a centred square, then shrinks. Returns a JPEG. The canvas drops EXIF and location data too. */
export async function prepareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const target = fitWithin(side, side, AVATAR_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare the photo.");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, target.width, target.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", AVATAR_QUALITY));
  if (!blob) throw new Error("Your browser could not prepare the photo.");
  return blob;
}
