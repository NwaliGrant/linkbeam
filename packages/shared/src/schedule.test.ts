import { describe, expect, it } from "vitest";
import { isLiveAt } from "./schedule";

const base = { enabled: true, starts_at: null, ends_at: null };

describe("isLiveAt", () => {
  it("is live with no schedule, and never when switched off", () => {
    expect(isLiveAt(base, 1000)).toBe(true);
    expect(isLiveAt({ ...base, enabled: false }, 1000)).toBe(false);
  });
  it("starts exactly at the start time", () => {
    expect(isLiveAt({ ...base, starts_at: 1000 }, 999)).toBe(false);
    expect(isLiveAt({ ...base, starts_at: 1000 }, 1000)).toBe(true);
  });
  it("stops exactly at the end time", () => {
    expect(isLiveAt({ ...base, ends_at: 2000 }, 1999)).toBe(true);
    expect(isLiveAt({ ...base, ends_at: 2000 }, 2000)).toBe(false);
  });
  it("handles a window", () => {
    const window = { ...base, starts_at: 1000, ends_at: 2000 };
    expect([999, 1000, 1999, 2000].map((now) => isLiveAt(window, now))).toEqual([false, true, true, false]);
  });
});
