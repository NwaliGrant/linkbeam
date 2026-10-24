import { describe, expect, it } from "vitest";
import { contrastRatio, meetsWcagAA, parseHex } from "./contrast";
import { textPairs, themes, type ThemeName } from "./tokens";

describe("contrast maths", () => {
  it("gives 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  it("gives 1:1 for identical colours", () => {
    expect(contrastRatio("#0B6B3A", "#0B6B3A")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0B6B3A", "#F6FAF4")).toBeCloseTo(contrastRatio("#F6FAF4", "#0B6B3A"), 10);
  });

  it("rejects malformed hex values", () => {
    expect(() => parseHex("#12345")).toThrow();
    expect(() => parseHex("red")).toThrow();
  });

  it("applies the 4.5 and 3 thresholds", () => {
    expect(meetsWcagAA("#777777", "#FFFFFF", "body")).toBe(false);
    expect(meetsWcagAA("#777777", "#FFFFFF", "large")).toBe(true);
  });
});

describe.each(["light", "dark"] as ThemeName[])("brand tokens in %s mode", (name) => {
  const theme = themes[name];
  it.each(textPairs)("$fg on $bg passes WCAG AA", ({ fg, bg, size }) => {
    const foreground = theme[fg];
    const background = theme[bg];
    expect(foreground, `missing token ${fg}`).toBeDefined();
    expect(background, `missing token ${bg}`).toBeDefined();
    const ratio = contrastRatio(foreground as string, background as string);
    expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(size === "body" ? 4.5 : 3);
  });
});
