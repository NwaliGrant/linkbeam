# Brand

Colours, type, logo and the rules for using the Linkbeam name.

## Colour tokens (from the master prompt)

| Token | Hex | Use |
|---|---|---|
| `--sl-forest` | `#0B6B3A` | Primary brand, buttons, links, headers |
| `--sl-lime` | `#8BE04E` | Highlights, success, focus accents on dark |
| `--sl-amber` | `#FFB703` | Secondary accent, badges. Never body text |
| `--sl-ink` | `#0E1A13` | Main text, dark surfaces |
| `--sl-paper` | `#F6FAF4` | Page background (light) |
| `--sl-mint` | `#DFF5E3` | Soft panels, selected states |
| `--sl-grey` | `#5B6B61` | Secondary text |
| `--sl-coral` | `#E5484D` | Errors, destructive actions |
| `--sl-sky` | `#2F80ED` | Information |

Semantic roles (`--bg`, `--text`, `--primary`, and so on) map these for light and dark mode. See `apps/web/src/styles/tokens.css`. The TypeScript copy is `packages/shared/src/tokens.ts`. Both must match.

## Contrast

Every text pair is checked against WCAG AA (4.5:1 body, 3:1 large) in both themes by `pnpm test`. Results are in `docs/DECISIONS.md` (D-004).

## Typography

Plus Jakarta Sans for headings, Inter for body. Both are self-hosted (`apps/web/public/fonts/`), so no visitor's browser calls another company's server for fonts. Both are under the SIL Open Font License (see `THIRD_PARTY_LICENSES.md`).

## Logo

The mark is a lime letter L (a corner, like a link turning) on a forest-green rounded square. It was drawn for this project and is part of the repository, so it is covered by the same MIT licence as the code. The name and mark are also covered by the guidelines below.

| File | Use |
|---|---|
| `docs/brand/linkbeam-mark.svg` | Main mark, for light and dark backgrounds |
| `docs/brand/linkbeam-mark-mono.svg` | One-colour version for print, stamps and low-colour screens |
| `apps/web/public/icons/*.png` | App icons (made by `node scripts/make-icons.mjs`) |

Rules for the logo:
- Leave empty space around the mark equal to a quarter of its width.
- Do not stretch, rotate, recolour (other than the mono file), add shadows, or put it on a busy picture.
- Keep it at least 24 px wide on screens.
- Write the name as **Linkbeam**: one word, capital L, lower-case b.

## Trademark note

The code is MIT. You may use, change and sell the code, including a copy that you run yourself.

The **Linkbeam name and logo** are not licensed for use in a way that suggests your site or product is the official project. Please:
- **Do**: say "built with Linkbeam" or "a fork of Linkbeam", link to the project, and keep the MIT licence text.
- **Do**: use a different name and logo for a service you run under your own brand, if it is changed in a way people could confuse with the original.
- **Do not**: present your site as the official Linkbeam, or use the name or logo to suggest the project endorses you.

This is a plain-language guide, not a legal contract. The owner can replace it with a formal policy.
