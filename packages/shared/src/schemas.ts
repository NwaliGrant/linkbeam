import { z } from "zod";
import { BG_STYLES, BUTTON_SHAPES, FONT_PAIRS } from "./appearance";
import {
  LINK_KINDS,
  MAX_LINKS_PER_USER,
  checkUsername,
  isPlainText,
  isValidAccent,
  normalizeEmail,
  normalizeTarget,
} from "./validators";

// In a browser the website runs under a content security policy with no 'unsafe-eval'. Zod would otherwise try to
// compile its checks with new Function() and the browser would log a policy violation. The plain, slower mode is
// more than fast enough for one small form. The Worker keeps the fast mode.
if ("window" in globalThis) z.config({ jitless: true });

export const THEMES = ["forest", "lime", "sunset", "ink", "paper", "mint", "amber", "sky"] as const;
export type ThemeId = (typeof THEMES)[number];

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid id.");

export const emailSchema = z
  .string()
  .max(254)
  .transform((value, ctx) => {
    const email = normalizeEmail(value);
    if (email === null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
      return z.NEVER;
    }
    return email;
  });

export const usernameSchema = z.string().transform((value, ctx) => {
  const result = checkUsername(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.reason });
    return z.NEVER;
  }
  return result.username;
});

const turnstileToken = z.string().max(2048).optional();

export const magicLinkRequestSchema = z.object({ email: emailSchema, turnstile_token: turnstileToken });

const ONE_LINE = "Remove hidden or direction-changing characters and line breaks.";
const MANY_LINES = "Remove hidden or direction-changing characters.";

export const profilePatchSchema = z.object({
  username: usernameSchema.optional(),
  display_name: z.string().trim().max(60).refine((value) => isPlainText(value), ONE_LINE).optional(),
  bio: z.string().trim().max(160).refine((value) => isPlainText(value, true), MANY_LINES).optional(),
  theme: z.enum(THEMES).optional(),
  accent: z
    .string()
    .refine(isValidAccent, "Use a colour like #0B6B3A.")
    .transform((value) => value.toUpperCase())
    .nullable()
    .optional(),
  button_shape: z.enum(BUTTON_SHAPES).optional(),
  font_pair: z.enum(FONT_PAIRS).optional(),
  bg_style: z.enum(BG_STYLES).optional(),
  show_badge: z.boolean().optional(),
});

const unixSeconds = z.number().int().min(0).max(4_102_444_800);

const linkFields = {
  title: z.string().trim().min(1).max(60).refine((value) => isPlainText(value), ONE_LINE),
  message: z.string().trim().max(300).refine((value) => isPlainText(value, true), MANY_LINES).nullable().optional(),
  enabled: z.boolean().optional(),
  starts_at: unixSeconds.nullable().optional(),
  ends_at: unixSeconds.nullable().optional(),
};

function scheduleIsOrdered(value: { starts_at?: number | null | undefined; ends_at?: number | null | undefined }): boolean {
  if (value.starts_at == null || value.ends_at == null) return true;
  return value.starts_at < value.ends_at;
}

/** A new link. Every kind needs an address (`target`), which is checked for its kind. */
export const createLinkSchema = z
  .object({
    kind: z.enum(LINK_KINDS).default("url"),
    target: z.string().max(2048),
    ...linkFields,
  })
  .refine(scheduleIsOrdered, { message: "The end must be after the start.", path: ["ends_at"] })
  .transform((value, ctx) => {
    const target = normalizeTarget(value.kind, value.target);
    if (target === null) {
      ctx.addIssue({ code: "custom", message: "This address or number is not valid for this link type.", path: ["target"] });
      return z.NEVER;
    }
    return { ...value, target };
  });

/** Kind cannot change after creation. The target is checked against the stored kind by the API. */
export const patchLinkSchema = z
  .object({
    title: linkFields.title.optional(),
    target: z.string().max(2048).optional(),
    message: linkFields.message,
    enabled: linkFields.enabled,
    starts_at: linkFields.starts_at,
    ends_at: linkFields.ends_at,
  })
  .refine(scheduleIsOrdered, { message: "The end must be after the start.", path: ["ends_at"] });

export const linkOrderSchema = z.object({
  ids: z.array(idSchema).max(MAX_LINKS_PER_USER),
});

export const trackSchema = z.object({
  page: z.string().max(40),
  link: idSchema.optional(),
});

export const reportSchema = z.object({
  page: z.string().max(40),
  reason: z.string().trim().min(1).max(500),
  turnstile_token: turnstileToken,
});

export const statsQuerySchema = z.object({
  days: z.enum(["7", "30"]).default("7").transform((value) => Number(value)),
});

export const callbackQuerySchema = z.object({ token: z.string().min(20).max(100) });

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(20).max(100),
});

export type CreateLinkInput = z.output<typeof createLinkSchema>;
export type PatchLinkInput = z.output<typeof patchLinkSchema>;
export type ProfilePatchInput = z.output<typeof profilePatchSchema>;
