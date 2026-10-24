/** Brand palette from the master prompt, section 3. Do not change values without updating docs/BRAND.md. */
export const brand = {
  forest: "#0B6B3A",
  lime: "#8BE04E",
  amber: "#FFB703",
  ink: "#0E1A13",
  paper: "#F6FAF4",
  mint: "#DFF5E3",
  grey: "#5B6B61",
  coral: "#E5484D",
  sky: "#2F80ED",
} as const;

export type ThemeName = "light" | "dark";

/** Semantic colour roles per theme. Every role is exposed as a CSS variable. */
export const themes: Record<ThemeName, Record<string, string>> = {
  light: {
    bg: brand.paper,
    surface: "#FFFFFF",
    "surface-soft": brand.mint,
    text: brand.ink,
    "text-muted": brand.grey,
    primary: brand.forest,
    "on-primary": "#FFFFFF",
    accent: brand.amber,
    "on-accent": brand.ink,
    highlight: brand.lime,
    "on-highlight": brand.ink,
    "error-text": "#B3262B",
    "info-text": "#1C5BB8",
    border: "#C9D8CD",
  },
  dark: {
    bg: brand.ink,
    surface: "#16241B",
    "surface-soft": "#1D3325",
    text: brand.paper,
    "text-muted": "#A9B9AE",
    primary: brand.lime,
    "on-primary": brand.ink,
    accent: brand.amber,
    "on-accent": brand.ink,
    highlight: brand.lime,
    "on-highlight": brand.ink,
    "error-text": "#FF8F92",
    "info-text": "#8DB8FF",
    border: "#2C4636",
  },
};

/** Text and background pairs that must pass WCAG AA in both themes. */
export const textPairs: ReadonlyArray<{ fg: string; bg: string; size: "body" | "large" }> = [
  { fg: "text", bg: "bg", size: "body" },
  { fg: "text", bg: "surface", size: "body" },
  { fg: "text", bg: "surface-soft", size: "body" },
  { fg: "text-muted", bg: "bg", size: "body" },
  { fg: "text-muted", bg: "surface", size: "body" },
  { fg: "primary", bg: "bg", size: "body" },
  { fg: "primary", bg: "surface", size: "body" },
  { fg: "on-primary", bg: "primary", size: "body" },
  { fg: "on-accent", bg: "accent", size: "body" },
  { fg: "on-highlight", bg: "highlight", size: "body" },
  { fg: "error-text", bg: "bg", size: "body" },
  { fg: "error-text", bg: "surface", size: "body" },
  { fg: "info-text", bg: "bg", size: "body" },
  { fg: "info-text", bg: "surface", size: "body" },
];
