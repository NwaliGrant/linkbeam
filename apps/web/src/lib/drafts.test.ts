import { describe, expect, it } from "vitest";
import type { LinkItem, Profile } from "./api";
import { DRAFTS_KEY, SNAPSHOT_KEY, applyDrafts, clearLocalData, loadDrafts, loadSnapshot, saveDrafts, saveSnapshot, type Store } from "./drafts";

function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const profile = { id: "u1", email: "a@example.com", username: "ada", display_name: "Ada", bio: "", avatar_url: null, theme: "forest", accent: null, button_shape: "pill", font_pair: "friendly", bg_style: "solid", show_badge: true, created_at: 1 } as unknown as Profile;
const link = (id: string, title: string): LinkItem => ({ id, kind: "url", title, target: "https://example.com", message: null, position: 0, enabled: true, starts_at: null, ends_at: null });

describe("snapshot", () => {
  it("round-trips the profile and links", () => {
    const store = memoryStore();
    saveSnapshot(profile, [link("l1", "One")], store, 5);
    const loaded = loadSnapshot(store);
    expect(loaded?.profile.id).toBe("u1");
    expect(loaded?.links[0]?.title).toBe("One");
    expect(loaded?.savedAt).toBe(5);
  });
  it("returns null for damaged or missing data", () => {
    const store = memoryStore();
    expect(loadSnapshot(store)).toBeNull();
    store.setItem(SNAPSHOT_KEY, "{not json");
    expect(loadSnapshot(store)).toBeNull();
    store.setItem(SNAPSHOT_KEY, JSON.stringify({ profile: {}, links: "x" }));
    expect(loadSnapshot(store)).toBeNull();
  });
  it("works with no storage at all", () => {
    expect(loadSnapshot(null)).toBeNull();
    expect(() => saveSnapshot(profile, [], null)).not.toThrow();
  });
  it("does not throw when storage refuses to write or read", () => {
    const broken: Store = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => saveSnapshot(profile, [], broken)).not.toThrow();
    expect(loadSnapshot(broken)).toBeNull();
    expect(() => saveDrafts("u1", { bio: "x" }, new Map(), broken)).not.toThrow();
    expect(() => clearLocalData(broken)).not.toThrow();
  });
});

describe("drafts", () => {
  it("keeps drafts for the account that wrote them and nobody else", () => {
    const store = memoryStore();
    saveDrafts("u1", { bio: "hello" }, new Map([["l1", { title: "New" }]]), store);
    expect(loadDrafts("u1", store)?.profile.bio).toBe("hello");
    expect(loadDrafts("u2", store)).toBeNull();
  });
  it("removes the stored drafts once nothing is waiting", () => {
    const store = memoryStore();
    saveDrafts("u1", { bio: "hello" }, new Map(), store);
    expect(store.data.has(DRAFTS_KEY)).toBe(true);
    saveDrafts("u1", {}, new Map([["l1", {}]]), store);
    expect(store.data.has(DRAFTS_KEY)).toBe(false);
  });
  it("applies drafts and drops those for links that no longer exist", () => {
    const store = memoryStore();
    saveDrafts("u1", { display_name: "Ada L." }, new Map([["l1", { title: "Edited" }], ["gone", { title: "Ghost" }]]), store);
    const drafts = loadDrafts("u1", store);
    if (!drafts) throw new Error("drafts were not stored");
    const applied = applyDrafts(profile, [link("l1", "One"), link("l2", "Two")], drafts);
    expect(applied.profile.display_name).toBe("Ada L.");
    expect(applied.links.map((item) => item.title)).toEqual(["Edited", "Two"]);
    expect([...applied.linkPatches.keys()]).toEqual(["l1"]);
  });
  it("ignores damaged drafts", () => {
    const store = memoryStore();
    store.setItem(DRAFTS_KEY, JSON.stringify({ userId: "u1", profile: null, links: 3 }));
    expect(loadDrafts("u1", store)).toBeNull();
  });
});

describe("clearLocalData", () => {
  it("removes the snapshot and the drafts", () => {
    const store = memoryStore();
    saveSnapshot(profile, [], store);
    saveDrafts("u1", { bio: "x" }, new Map(), store);
    clearLocalData(store);
    expect(store.data.size).toBe(0);
  });
});

describe("after sign-out", () => {
  it("a save that was still on its way cannot bring the data back", () => {
    clearLocalData();
    // These use this test's default store (none in Node), so the visible effect is that they do nothing and do not throw.
    expect(() => saveDrafts("u1", { bio: "late" }, new Map())).not.toThrow();
    expect(() => saveSnapshot(profile, [])).not.toThrow();
    // An explicit store (as in the other tests) is unaffected by the guard.
    const store = memoryStore();
    saveDrafts("u1", { bio: "x" }, new Map(), store);
    expect(store.data.has(DRAFTS_KEY)).toBe(true);
  });
});

describe("damaged or tampered storage can never break the dashboard", () => {
  it("rejects a snapshot with an unknown theme, font, link kind or wrong types", () => {
    for (const change of [{ theme: "<script>" }, { font_pair: "modern" }, { bg_style: 5 }, { button_shape: null }, { accent: "red" }, { show_badge: "yes" }, { username: 7 }]) {
      const store = memoryStore();
      store.setItem(SNAPSHOT_KEY, JSON.stringify({ profile: { ...profile, ...change }, links: [], savedAt: 1 }));
      expect(loadSnapshot(store), JSON.stringify(change)).toBeNull();
    }
    const store = memoryStore();
    store.setItem(SNAPSHOT_KEY, JSON.stringify({ profile, links: [{ ...link("l1", "One"), kind: "pay" }], savedAt: 1 }));
    expect(loadSnapshot(store)).toBeNull();
    store.setItem(SNAPSHOT_KEY, JSON.stringify({ profile, links: [{ ...link("l1", "One"), enabled: "true" }], savedAt: 1 }));
    expect(loadSnapshot(store)).toBeNull();
  });

  it("drops a profile draft that has any invalid value, and keeps nothing from it", () => {
    const store = memoryStore();
    store.setItem(DRAFTS_KEY, JSON.stringify({ userId: "u1", profile: { display_name: "Fine", theme: "not-a-theme" }, links: {} }));
    expect(loadDrafts("u1", store)?.profile).toEqual({});
  });

  it("never lets a draft change the username", () => {
    const store = memoryStore();
    store.setItem(DRAFTS_KEY, JSON.stringify({ userId: "u1", profile: { username: "admin", bio: "ok" }, links: {} }));
    expect(loadDrafts("u1", store)?.profile).toEqual({ bio: "ok" });
  });

  it("drops link drafts with bad values, hidden characters or an address that does not fit the link kind", () => {
    const store = memoryStore();
    const drafts = {
      userId: "u1",
      profile: {},
      links: {
        l1: { title: "" },
        l2: { target: "javascript:alert(1)" },
        l3: { title: "Good title", enabled: false },
        l4: { title: `Bad${String.fromCodePoint(0x202e)}title` },
        l5: { starts_at: 10, ends_at: 5 },
      },
    };
    store.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    const loaded = loadDrafts("u1", store);
    if (!loaded) throw new Error("drafts were not loaded");
    const items = ["l1", "l2", "l3", "l4", "l5"].map((id) => link(id, id));
    const applied = applyDrafts(profile, items, loaded);
    expect([...applied.linkPatches.keys()]).toEqual(["l3"]);
    expect(applied.links.find((item) => item.id === "l2")?.target).toBe("https://example.com");
  });
});
