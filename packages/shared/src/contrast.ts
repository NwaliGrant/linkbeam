const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function parseHex(hex: string): [number, number, number] {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(`Invalid hex colour: ${hex}`);
  }
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelToLinear(channel: number): number {
  const scaled = channel / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export type TextSize = "body" | "large";

export function meetsWcagAA(foreground: string, background: string, size: TextSize = "body"): boolean {
  return contrastRatio(foreground, background) >= (size === "body" ? 4.5 : 3);
}
