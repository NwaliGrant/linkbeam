import { describe, expect, it } from "vitest";
import { PAGE_THEMES, BG_STYLES, BUTTON_SHAPES, FONT_PAIRS, mix, pageBackground, readableOn, resolveAppearance } from "./appearance";
import { contrastRatio } from "./contrast";
import { THEMES } from "./schemas";

const base = { accent: null, button_shape: "pill", font_pair: "friendly", bg_style: "solid" } as const;

describe("page themes meet WCAG AA", () => {
  for (const id of THEMES) {
    const theme = PAGE_THEMES[id];
    it(`${id}: text, muted text and button label are readable, and buttons stand out`, () => {
      expect(contrastRatio(theme.text, theme.bg), "text on bg").toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.muted, theme.bg), "muted on bg").toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.onButton, theme.button), "label on button").toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.button, theme.bg), "button against page").toBeGreaterThanOrEqual(3);
    });
    it(`${id}: text stays readable on the far end of the gradient`, () => {
      const { far } = pageBackground(theme, "gradient");
      expect(contrastRatio(theme.text, far)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.muted, far)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.button, far)).toBeGreaterThanOrEqual(3);
    });
  }
  it("has a theme for every id the API accepts", () => {
    expect(Object.keys(PAGE_THEMES).sort()).toEqual([...THEMES].sort());
  });
});

describe("mix and readableOn", () => {
  it("blends colours at the ends and in the middle", () => {
    expect(mix("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
  it("picks dark text on light colours and white on dark ones", () => {
    expect(readableOn("#FFFFFF")).toBe("#0E1A13");
    expect(readableOn("#0B6B3A")).toBe("#FFFFFF");
  });
});

describe("resolveAppearance", () => {
  it("uses the theme button colour by default and has no warnings", () => {
    const result = resolveAppearance({ ...base, theme: "forest" });
    expect(result.vars["--p-button"]).toBe("#0B6B3A");
    expect(result.vars["--p-on-button"]).toBe("#FFFFFF");
    expect(result.warnings).toEqual([]);
  });

  it("applies every shape, font pair and background", () => {
    const radii = BUTTON_SHAPES.map((shape) => resolveAppearance({ ...base, theme: "ink", button_shape: shape }).vars["--p-radius"]);
    expect(new Set(radii).size).toBe(3);
    const fonts = FONT_PAIRS.map((pair) => resolveAppearance({ ...base, theme: "ink", font_pair: pair }).vars["--p-font-heading"]);
    expect(new Set(fonts).size).toBe(2);
    const images = BG_STYLES.map((style) => resolveAppearance({ ...base, theme: "ink", bg_style: style }).vars["--p-bg-image"]);
    expect(images[0]).toBe("none");
    expect(images[1]).toContain("linear-gradient");
    expect(images[2]).toContain("radial-gradient");
  });

  it("picks a readable label colour for any accent", () => {
    for (const accent of ["#FFB703", "#0B6B3A", "#E5484D", "#2F80ED", "#FFFFFF", "#000000", "#808080"]) {
      const result = resolveAppearance({ ...base, theme: "paper", accent });
      expect(result.vars["--p-button"]).toBe(accent);
      expect(["#0E1A13", "#FFFFFF"]).toContain(result.vars["--p-on-button"]);
    }
  });

  it("warns when the label cannot be read on the accent", () => {
    // Mid grey #777777: neither dark nor white text reaches 4.5:1.
    const result = resolveAppearance({ ...base, theme: "paper", accent: "#777777" });
    expect(result.warnings.join(" ")).toMatch(/hard to read/);
  });

  it("warns when buttons blend into the page background, and not otherwise", () => {
    expect(resolveAppearance({ ...base, theme: "paper", accent: "#FAFAFA" }).warnings.join(" ")).toMatch(/blend into the background/);
    expect(resolveAppearance({ ...base, theme: "paper", accent: "#0B6B3A" }).warnings).toEqual([]);
  });
});
