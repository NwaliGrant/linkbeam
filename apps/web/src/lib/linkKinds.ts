import { LINK_KINDS, normalizeTarget, t, type LinkKind, type MessageKey } from "@linkbeam/shared";

const key = (name: string): MessageKey => name as MessageKey;

/** Names of the link types, from the translation file. */
export const KIND_LABELS: Record<LinkKind, string> = Object.fromEntries(LINK_KINDS.map((kind) => [kind, t(key(`link.kind.${kind}`))])) as Record<LinkKind, string>;

type Help = { label: string; placeholder: string; hint: string; inputMode: "url" | "tel" | "email" | "text" };
const INPUT_MODES: Record<LinkKind, Help["inputMode"]> = { url: "url", whatsapp: "tel", coffee: "url", call: "tel", email: "email", map: "text" };

/** Label, example and hint for each address box, from the translation file. */
export const TARGET_HELP: Record<LinkKind, Help> = Object.fromEntries(
  LINK_KINDS.map((kind) => [
    kind,
    {
      label: t(key(`link.target.${kind}.label`)),
      placeholder: t(key(`link.target.${kind}.placeholder`)),
      hint: t(key(`link.target.${kind}.hint`)),
      inputMode: INPUT_MODES[kind],
    },
  ]),
) as Record<LinkKind, Help>;

/** Returns a plain-English problem with a title, or null when it is fine. */
export function titleProblem(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length === 0) return t("link.title.empty");
  if (trimmed.length > 60) return t("link.title.tooLong");
  return null;
}

/** Returns the cleaned target, or a plain-English problem. */
export function checkTarget(kind: LinkKind, raw: string): { ok: true; value: string } | { ok: false; problem: string } {
  if (raw.trim().length === 0) return { ok: false, problem: t(key(`link.target.${kind}.empty`)) };
  const value = normalizeTarget(kind, raw.trim());
  if (value === null) return { ok: false, problem: t(key(`link.target.${kind}.invalid`)) };
  return { ok: true, value };
}
