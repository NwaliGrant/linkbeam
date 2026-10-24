import { normalizeTarget, type LinkKind } from "./validators";

/**
 * The address a visitor's button opens. The target is checked again here, even though it was checked
 * when it was saved, so a bad row in the database can never become a dangerous link.
 * Returns null when the target is not acceptable for its kind.
 */
export function linkHref(kind: LinkKind, target: string, message?: string | null): string | null {
  const clean = normalizeTarget(kind, target);
  if (clean === null) return null;
  switch (kind) {
    case "url":
    case "coffee":
    case "map":
      return clean;
    case "whatsapp": {
      const base = `https://wa.me/${clean.slice(1)}`;
      const text = message?.trim();
      return text ? `${base}?text=${encodeURIComponent(text)}` : base;
    }
    case "call":
      return `tel:${clean}`;
    case "email":
      return `mailto:${clean}`;
  }
}
