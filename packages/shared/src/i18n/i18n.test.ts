import { describe, expect, it } from "vitest";
import { en } from "./en";
import { LOCALES, translate, translator } from "./index";

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

describe("translation files", () => {
  it("English has no empty messages", () => {
    for (const [key, text] of Object.entries(en)) expect(text.trim().length, key).toBeGreaterThan(0);
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    describe(`language "${locale}"`, () => {
      it("has exactly the same keys as English", () => {
        expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
      });
      it("keeps every {placeholder} of the English text", () => {
        for (const key of Object.keys(en) as Array<keyof typeof en>) {
          expect(placeholders(messages[key]), `${locale}: ${key}`).toEqual(placeholders(en[key]));
        }
      });
      it("has no empty messages", () => {
        for (const [key, text] of Object.entries(messages)) expect(text.trim().length, `${locale}: ${key}`).toBeGreaterThan(0);
      });
    });
  }
});

describe("translate", () => {
  it("fills in placeholders", () => {
    expect(translate("en", "public.title.withName", { name: "Ada", username: "ada" })).toBe("Ada (@ada) | Linkbeam");
  });
  it("leaves an unknown placeholder visible instead of hiding the mistake", () => {
    expect(translate("en", "public.title.withName", { name: "Ada" })).toBe("Ada (@{username}) | Linkbeam");
  });
  it("falls back to English for an unknown language", () => {
    expect(translate("zz", "public.report")).toBe("Report this page");
    expect(translator("zz")("public.badge")).toBe("Made with Linkbeam");
  });
  it("does not treat user text as a placeholder (no double expansion)", () => {
    expect(translate("en", "public.description.default", { name: "{username}" })).toBe("{username}'s links, all in one place.");
  });
});

describe("how the language list is checked", () => {
  it("would catch a language with a missing key or a lost placeholder", () => {
    const broken = { ...en, "public.report": "" } as Record<string, string>;
    delete broken["public.badge"];
    broken["public.title.plain"] = "@ | Linkbeam";
    expect(Object.keys(broken)).not.toEqual(Object.keys(en));
    expect(placeholders(broken["public.title.plain"] ?? "")).not.toEqual(placeholders(en["public.title.plain"]));
  });
});
