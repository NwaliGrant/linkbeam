import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrMatrix, qrPixels, qrSvg } from "./qr";

const URL_TEXT = "https://linkbeam.pages.dev/u/grant";

describe("QR code", () => {
  it("can be read back by a real QR decoder", () => {
    const { width, height, data } = qrPixels(qrMatrix(URL_TEXT), 600);
    expect(jsQR(data, width, height)?.data).toBe(URL_TEXT);
  });

  it("works for long addresses and plain characters", () => {
    for (const text of [`https://example.com/u/${"a".repeat(60)}`, "https://linkbeam.pages.dev/u/ada_lovelace-1"]) {
      const { width, height, data } = qrPixels(qrMatrix(text), 800);
      expect(jsQR(data, width, height)?.data).toBe(text);
    }
  });

  it("keeps a quiet border and whole-pixel modules", () => {
    const matrix = qrMatrix(URL_TEXT);
    const { width, data } = qrPixels(matrix, 1024);
    expect(width % (matrix.length + 8)).toBe(0);
    expect([data[0], data[1], data[2], data[3]]).toEqual([255, 255, 255, 255]);
  });

  it("makes a valid scalable picture with the same dark squares", () => {
    const matrix = qrMatrix(URL_TEXT);
    const svg = qrSvg(matrix);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${matrix.length + 8} ${matrix.length + 8}"`);
    expect(svg).not.toMatch(/<script|onload|href/i);
    const dark = matrix.flat().filter(Boolean).length;
    const path = /<path d="([^"]*)"/.exec(svg)?.[1] ?? "";
    const covered = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    expect(covered).toBe(dark);
  });
});
