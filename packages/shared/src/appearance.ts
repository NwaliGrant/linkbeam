import { contrastRatio, parseHex } from "./contrast";
import type { ThemeId } from "./schemas";

export const BUTTON_SHAPES = ["pill", "rounded", "square"] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];
export const FONT_PAIRS = ["friendly", "clean"] as const;
export type FontPair = (typeof FONT_PAIRS)[number];
export const BG_STYLES = ["solid", "gradient", "pattern"] as const;
export type BgStyle = (typeof BG_STYLES)[number];

export interface PageTheme {
  label: string;
  bg: string;
  text: string;
  muted: string;
  button: string;
  onButton: string;
}

/** Colours of the eight public-page themes. Every pair is checked for contrast in appearance.test.ts. */
export const PAGE_THEMES: Record<ThemeId, PageTheme> = {
  forest: { label: "Forest", bg: "#F6FAF4", text: "#0E1A13", muted: "#4A5A50", button: "#0B6B3A", onButton: "#FFFFFF" },
  lime: { label: "Lime", bg: "#0E1A13", text: "#F6FAF4", muted: "#A9B9AE", button: "#8BE04E", onButton: "#0E1A13" },
  sunset: { label: "Sunset", bg: "#FFF1E6", text: "#3B1A08", muted: "#6B4A36", button: "#C2410C", onButton: "#FFFFFF" },
  ink: { label: "Ink", bg: "#15151A", text: "#F5F5F7", muted: "#B0B0BA", button: "#F5F5F7", onButton: "#15151A" },
  paper: { label: "Paper", bg: "#FFFFFF", text: "#111827", muted: "#4B5563", button: "#111827", onButton: "#FFFFFF" },
  mint: { label: "Mint", bg: "#DFF5E3", text: "#0E1A13", muted: "#3F5A49", button: "#0B6B3A", onButton: "#FFFFFF" },
  amber: { label: "Amber", bg: "#FFB703", text: "#0E1A13", muted: "#3A2C00", button: "#0E1A13", onButton: "#FFB703" },
  sky: { label: "Sky", bg: "#EAF2FF", text: "#0B2A55", muted: "#3D5A85", button: "#1C5BB8", onButton: "#FFFFFF" },
};

const RADIUS: Record<ButtonShape, string> = { pill: "999px", rounded: "12px", square: "4px" };
const FONTS: Record<FontPair, { heading: string; body: string }> = {
  friendly: { heading: '"Plus Jakarta Sans", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif' },
  clean: { heading: '"Inter", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif' },
};

const DARK = "#0E1A13";
const WHITE = "#FFFFFF";

function toHex(channels: [number, number, number]): string {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Blend two colours. amount 0 gives a, 1 gives b. */
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex([ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount]);
}

/** The text colour, dark or white, that reads best on a given background. */
export function readableOn(background: string): string {
  return contrastRatio(DARK, background) >= contrastRatio(WHITE, background) ? DARK : WHITE;
}

export interface AppearanceInput {
  theme: ThemeId;
  accent: string | null;
  button_shape: ButtonShape;
  font_pair: FontPair;
  bg_style: BgStyle;
}

export interface Appearance {
  /** CSS custom properties for a page or preview element. */
  vars: Record<string, string>;
  /** Plain-English warnings for the Design tab. Empty when everything is readable. */
  warnings: string[];
}

export function pageBackground(theme: PageTheme, style: BgStyle): { background: string; far: string } {
  const far = style === "gradient" ? mix(theme.bg, theme.button, 0.12) : theme.bg;
  return { background: far, far };
}

export function resolveAppearance(input: AppearanceInput): Appearance {
  const theme = PAGE_THEMES[input.theme];
  const button = input.accent ?? theme.button;
  const onButton = input.accent ? readableOn(input.accent) : theme.onButton;
  const { far } = pageBackground(theme, input.bg_style);

  let image = "none";
  if (input.bg_style === "gradient") image = `linear-gradient(160deg, ${theme.bg} 0%, ${far} 100%)`;
  if (input.bg_style === "pattern") {
    const dot = mix(theme.bg, theme.text, 0.1);
    image = `radial-gradient(${dot} 1.5px, transparent 1.5px)`;
  }

  const warnings: string[] = [];
  if (input.accent) {
    if (contrastRatio(onButton, input.accent) < 4.5) {
      warnings.push("Text on your buttons will be hard to read. Choose a darker or lighter colour.");
    }
    if (contrastRatio(input.accent, theme.bg) < 3) {
      warnings.push("Your buttons will blend into the background. Choose a colour that stands out more.");
    }
  }

  return {
    vars: {
      "--p-bg": theme.bg,
      "--p-bg-image": image,
      "--p-bg-size": input.bg_style === "pattern" ? "16px 16px" : "auto",
      "--p-text": theme.text,
      "--p-muted": theme.muted,
      "--p-button": button,
      "--p-on-button": onButton,
      "--p-radius": RADIUS[input.button_shape],
      "--p-font-heading": FONTS[input.font_pair].heading,
      "--p-font-body": FONTS[input.font_pair].body,
    },
    warnings,
  };
}
