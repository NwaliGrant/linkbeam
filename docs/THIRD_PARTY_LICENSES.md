# Third-party licences

Linkbeam is MIT licensed. Everything it depends on must be compatible with that. This file lists direct dependencies and bundled assets. Every dependency, direct or indirect, is also checked by `node scripts/licenses.mjs`, which writes the full lists to `docs/evidence/stage7/` and fails if it finds a licence that is neither permissive nor explained (see "Full scan" at the end).

## Direct dependencies

| Package | Version | Licence | Used for |
|---|---|---|---|
| @astrojs/check | 0.9.10 | MIT |  |
| @astrojs/preact | 6.1.0 | MIT |  |
| @axe-core/playwright | 4.14.0 | MPL-2.0 | Accessibility tests (dev only, not shipped) |
| @cloudflare/workers-types | 5.20261015.1 | MIT OR Apache-2.0 |  |
| @eslint/js | 10.0.1 | MIT |  |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 | Source of the Inter font files (see Fonts) |
| @fontsource-variable/plus-jakarta-sans | 5.3.0 | OFL-1.1 | Source of the Plus Jakarta Sans font files (see Fonts) |
| @playwright/test | 1.64.1 | Apache-2.0 | Browser tests (dev) |
| @types/node | 26.6.5 | MIT |  |
| @vitest/coverage-v8 | 5.0.5 | MIT |  |
| arctic | 3.7.0 | MIT | Google and GitHub sign-in |
| astro | 7.4.0 | MIT | Website framework |
| eslint | 10.12.0 | MIT | Linting (dev) |
| globals | 17.13.0 | MIT |  |
| hono | 4.13.13 | MIT | API framework |
| lucide-preact | 1.59.0 | ISC | Icons |
| miniflare | 4.20260730.0 | MIT | Local database for tests (dev) |
| preact | 11.0.1 | MIT | Website UI |
| sharp | 0.35.5 | Apache-2.0 | Test images (dev only) |
| typescript | 6.0.3 | Apache-2.0 | Type checking (dev) |
| typescript-eslint | 8.71.2 | MIT |  |
| vitest | 5.0.5 | MIT | Unit tests (dev) |
| wrangler | 4.151.0 | MIT OR Apache-2.0 | Local Workers runtime and deploys (dev) |
| yaml | 2.9.1 | ISC |  |
| zod | 4.6.7 | MIT | Input validation |

`@axe-core/playwright` is MPL-2.0. That licence applies to changes made to its own files. We only run it in tests and do not copy, change or ship it, so it places no condition on Linkbeam's MIT licence.

## Fonts (self-hosted, `apps/web/public/fonts/`)

| Font | Licence | Source | Files |
|---|---|---|---|
| Inter (variable) | SIL Open Font License 1.1 | https://github.com/rsms/inter, via the `@fontsource-variable/inter` package | `inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2` |
| Plus Jakarta Sans (variable) | SIL Open Font License 1.1 | https://github.com/tokotype/PlusJakartaSans, via `@fontsource-variable/plus-jakarta-sans` | `plus-jakarta-sans-latin-wght-normal.woff2`, `plus-jakarta-sans-latin-ext-wght-normal.woff2` |

The licence texts are next to the font files (`LICENSE-inter.txt`, `LICENSE-plus-jakarta-sans.txt`). The OFL allows use, embedding and redistribution with the licence text. The files are not renamed or modified. Only the Latin and Latin Extended parts are included (Latin Extended covers Yoruba and Igbo letters such as ọ, ẹ and ṣ).

## Icons

- **Lucide** (ISC): interface icons, through `lucide-preact`. https://lucide.dev
- **Simple Icons** (CC0 1.0): the Google and GitHub marks on the sign-in buttons, copied into `apps/web/src/lib/brandIcons.ts` (version 16.35.0). https://simpleicons.org. The marks are trademarks of their owners and are used only to name those sign-in methods.
- The Linkbeam name and logo are made for this project (Stage 7 provides the logo SVG).

## Added in Stage 4

| Package | Licence | Used for |
|---|---|---|
| `qrcode-generator` | MIT | Making QR codes in the Share tab (loaded only on that tab) |
| `jsqr` | Apache-2.0 | Tests only: reads a QR code back to prove it scans |
| `pngjs` | MIT | Tests only: reads the downloaded PNG |
| `lighthouse` | Apache-2.0 | Tests only: the `pnpm lighthouse` audit |

The public page also contains the shapes of five Lucide icons (ISC licence) copied into `apps/api/src/publicPage.ts`, so the page needs no icon file or script. `og-default.png` and `favicon.svg` are made for this project.


## Full scan (Stage 7)

Run `node scripts/licenses.mjs`. Result on 2026-10-23: **269 packages in production** and **575 in total** (including test and build tools). The full lists are `docs/evidence/stage7/licenses-production.csv` and `licenses-all.csv`.

All are permissive (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, OFL-1.1) except these three, which are fine for an MIT project and are not part of what gets deployed:

| Licence | Packages | Why it is fine |
|---|---|---|
| LGPL-3.0-or-later | `@img/sharp-libvips-*` (the image library inside `sharp`) | A separate binary that is only used on the developer's or the build machine. We do not change it, copy it into this repository or ship it. The Worker bundle was checked and contains none of it. |
| MPL-2.0 | `lightningcss` (CSS build tool) and `axe-core` (tests) | File-level licence. We do not change or ship these files. |
| CC-BY-4.0 | `caniuse-lite` (browser data used by build tools) | Data used only while building. Credit: Alexis Deveria and Sergey Rubanov. |

The deployed result is the website files, the Worker bundle (Hono, Zod, Arctic and our own code) and the two self-hosted fonts. A new dependency with another licence makes the licence check fail until someone reads it and writes down a reason.
