import { en, type MessageKey } from "./en";

export type { MessageKey };
export type Messages = Record<MessageKey, string>;

/**
 * Every language Linkbeam can show. To add one, copy en.ts to a new file (for example fr.ts),
 * translate the values, and add it here. The tests fail if a key or a {placeholder} is missing.
 */
export const LOCALES: Record<string, Messages> = { en };
export const DEFAULT_LOCALE = "en";

export type Params = Record<string, string | number>;

/** Looks a message up and fills in {placeholders}. Falls back to English, and finally to the key itself. */
export function translate(locale: string, key: MessageKey, params: Params = {}): string {
  const text = LOCALES[locale]?.[key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** A translate function fixed to one language. */
export function translator(locale: string = DEFAULT_LOCALE): (key: MessageKey, params?: Params) => string {
  return (key, params) => translate(locale, key, params);
}

export const t = translator(DEFAULT_LOCALE);
