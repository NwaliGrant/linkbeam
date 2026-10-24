import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, api } from "./api";
import { createAutosave, type SaveStatus } from "./autosave";
import { fitWithin } from "./avatar";
import { KIND_LABELS, TARGET_HELP, checkTarget, titleProblem } from "./linkKinds";
import { indexAtY, moveItem } from "./reorder";
import { fromLocalInput, toLocalInput } from "./time";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("moveItem and indexAtY", () => {
  it("moves an item down, up, and leaves bad moves alone", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
  it("does not change the list it is given", () => {
    const original = ["a", "b", "c"];
    moveItem(original, 0, 2);
    expect(original).toEqual(["a", "b", "c"]);
  });
  it("finds the row nearest to the pointer", () => {
    expect(indexAtY([50, 150, 250], 10)).toBe(0);
    expect(indexAtY([50, 150, 250], 140)).toBe(1);
    expect(indexAtY([50, 150, 250], 999)).toBe(2);
    expect(indexAtY([], 5)).toBe(0);
  });
});

describe("fitWithin", () => {
  it("shrinks the longest side and keeps the shape", () => {
    expect(fitWithin(4000, 2000, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(1000, 3000, 512)).toEqual({ width: 171, height: 512 });
  });
  it("never makes a small picture bigger", () => {
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 });
  });
  it("never returns a zero side", () => {
    expect(fitWithin(10000, 1, 512).height).toBe(1);
  });
});

describe("link form checks", () => {
  it("accepts good targets and gives the cleaned value", () => {
    expect(checkTarget("url", " https://example.com ")).toEqual({ ok: true, value: "https://example.com/" });
    expect(checkTarget("whatsapp", "+234 801 234 5678")).toEqual({ ok: true, value: "+2348012345678" });
    expect(checkTarget("email", "Me@Example.com")).toEqual({ ok: true, value: "me@example.com" });
  });
  it("explains problems in plain English, with a hint", () => {
    const empty = checkTarget("url", "  ");
    expect(empty.ok).toBe(false);
    const bad = checkTarget("whatsapp", "08012345678");
    expect(bad.ok === false && bad.problem).toMatch(/country code/);
  });
  it("rejects dangerous addresses", () => {
    for (const raw of ["javascript:alert(1)", "data:text/html,x", "java\tscript:alert(1)", "//evil.com", "https://user:pw@example.com"]) {
      expect(checkTarget("url", raw).ok, raw).toBe(false);
    }
  });
  it("checks titles", () => {
    expect(titleProblem("   ")).toMatch(/Add a title/);
    expect(titleProblem("x".repeat(61))).toMatch(/60/);
    expect(titleProblem("My shop")).toBeNull();
  });
});

describe("time inputs", () => {
  it("round-trips and handles empty text", () => {
    const now = Math.floor(Date.UTC(2026, 9, 19, 12, 30) / 1000);
    expect(fromLocalInput(toLocalInput(now))).toBe(now);
    expect(toLocalInput(null)).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("not a date")).toBeNull();
  });
});

describe("createAutosave", () => {
  function setup() {
    vi.useFakeTimers();
    const statuses: SaveStatus[] = [];
    const saver = createAutosave({ delay: 500, onStatus: (s) => statuses.push(s) });
    return { saver, statuses };
  }

  it("sends only the last change after the pause, and ends on Saved", async () => {
    const { saver, statuses } = setup();
    const job = vi.fn(async () => undefined);
    saver.schedule("profile", async () => { await job(); });
    const second = vi.fn(async () => undefined);
    saver.schedule("profile", second);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(job).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("saved");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("shows Saving while waiting and while sending", async () => {
    const { saver, statuses } = setup();
    let finish: () => void = () => undefined;
    saver.schedule("a", () => new Promise<void>((resolve) => { finish = resolve; }));
    expect(statuses.at(-1)).toBe("saving");
    await vi.advanceTimersByTimeAsync(500);
    expect(statuses.at(-1)).toBe("saving");
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("keeps different keys separate", async () => {
    const { saver } = setup();
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    saver.schedule("a", a);
    saver.schedule("b", b);
    await vi.advanceTimersByTimeAsync(500);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("reports a failure with its message, keeps the job, and retry sends it again", async () => {
    const { saver, statuses } = setup();
    let fail = true;
    const job = vi.fn(async () => {
      if (fail) throw new Error("No connection");
    });
    saver.schedule("a", job, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("error");
    expect(saver.hasUnsaved()).toBe(true);
    fail = false;
    await saver.retry();
    expect(job).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe("saved");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("flush sends waiting work at once", async () => {
    const { saver } = setup();
    const job = vi.fn(async () => undefined);
    saver.schedule("a", job);
    await saver.flush();
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("cancel drops waiting and failed work, for a deleted link", async () => {
    const { saver } = setup();
    const waiting = vi.fn(async () => undefined);
    saver.schedule("a", waiting);
    saver.cancel("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(waiting).not.toHaveBeenCalled();
    saver.schedule("b", async () => { throw new Error("x"); }, true);
    await vi.advanceTimersByTimeAsync(0);
    saver.cancel("b");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("a newer edit replaces a failed one for the same key", async () => {
    const { saver, statuses } = setup();
    saver.schedule("a", async () => { throw new Error("x"); }, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("error");
    const good = vi.fn(async () => undefined);
    saver.schedule("a", good, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("saved");
  });
});

describe("api client", () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends JSON to the same host with credentials, and returns the body", async () => {
    const fetchMock = vi.fn(async () => reply(200, { id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.patchMe({ bio: "Hi" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/me");
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe('{"bio":"Hi"}');
  });

  it("turns the API error shape into an ApiFailure", async () => {
    vi.stubGlobal("fetch", async () => reply(409, { error: { code: "username_taken", message: "This username is taken. Please choose another." } }));
    const error = await api.patchMe({ username: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiFailure);
    expect(error).toMatchObject({ status: 409, code: "username_taken", message: "This username is taken. Please choose another." });
  });

  it("gives a friendly message when the network fails or the body is not JSON", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    expect(await api.me().catch((e: unknown) => e)).toMatchObject({ status: 0, code: "network" });
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 502 }));
    expect(await api.me().catch((e: unknown) => e)).toMatchObject({ status: 502, code: "server_error", message: "Something went wrong. Please try again." });
  });

  it("encodes ids in paths and never sends a content type for file uploads", async () => {
    const fetchMock = vi.fn(async () => reply(201, { avatar_url: "/api/v1/avatar/k" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.uploadAvatar(new Blob(["x"], { type: "image/jpeg" }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await api.deleteLink("a/b?c");
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe("/api/v1/links/a%2Fb%3Fc");
  });
});

describe("map and coffee boxes", () => {
  it("map takes a plain address", () => {
    const result = checkTarget("map", "12 Herbert Macaulay Way, Yaba");
    expect(result.ok && result.value).toContain("https://www.google.com/maps/search/?api=1&query=12%20Herbert");
  });
  it("a coffee link must be an https Buy Me a Coffee address", () => {
    expect(checkTarget("coffee", "http://buymeacoffee.com/your-name").ok).toBe(false);
    expect(checkTarget("coffee", "https://paystack.com/pay/x").ok).toBe(false);
    expect(checkTarget("coffee", "https://buymeacoffee.com/your-name").ok).toBe(true);
    const empty = checkTarget("coffee", "  ");
    expect(!empty.ok && empty.problem).toMatch(/Buy Me a Coffee/);
  });
  it("labels and hints come from the translation file", () => {
    expect(KIND_LABELS.coffee).toBe("Buy me a coffee");
    expect(TARGET_HELP.coffee.placeholder).toBe("https://buymeacoffee.com/your-name");
    expect(TARGET_HELP.map.label).toBe("Address or map link");
  });
});
