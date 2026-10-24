# Decisions

Reversible choices made while building, with the reason. Newest last. Format: what, why, how to undo.

## D-001: TypeScript 6.0, not 7.x
`pnpm add typescript` installed 7.0.2, which `typescript-eslint` 8.x does not support yet (peer range `<6.1.0`). Pinned to `~6.0.3` in every package. Undo: raise the pin when typescript-eslint supports 7.

## D-002: Email provider is Brevo free, Resend is the fallback
- Brevo free: 300 emails/day, transactional API and SMTP included, no card stated for the free plan.
- Resend free: 3,000/month but only 100/day, so a busy sign-up day would block magic links.
- Magic links are the only login method, so the higher daily cap matters. See `FREE_TIER_LIMITS.md`.
- Local dev prints the link to the console and sends nothing.

## D-003: Avatars are stored as small blobs in D1, not R2
R2's own pricing page lists a free tier, but several sources say activating R2 needs a payment method, and one source says it does not. I could not confirm this from Cloudflare's dashboard. The brief says: if R2 asks for a card, use D1. Avatars are capped at 1 MB each (see D-012 for why they are cleaned rather than resized, and how size will be kept down). Revisit if R2 is confirmed card-free for this account.

## D-004: Contrast uses two text variants for error and info
The raw brand colours fail WCAG AA as text on the light paper background:

| Pair | Ratio | Needed |
|---|---|---|
| coral `#E5484D` on paper | 3.71 | 4.5 |
| sky `#2F80ED` on paper | 3.66 | 4.5 |
| amber `#FFB703` on paper | 1.65 | 4.5 |

So `--error-text` is `#B3262B` and `--info-text` is `#1C5BB8` in light mode (lighter tints in dark mode). The raw coral and sky stay available for icons, borders and large shapes. Amber is never used for text, as the brand table already says. Every pair is tested in `packages/shared/src/contrast.test.ts`.

## D-005: Light and dark mappings
Dark mode follows the system by default. A `data-theme="light"` or `data-theme="dark"` attribute on `<html>` overrides it. Primary is forest green in light mode and lime in dark mode, because forest on the dark ink background is too dim.

## D-006: Fonts are not self-hosted yet
The brief asks for self-hosted Plus Jakarta Sans and Inter (WOFF2). Stage 0 uses the `system-ui` fallback. Self-hosting is planned for Stage 3 (dashboard), where the font files will be added from the OFL-licensed Fontsource packages and the licences recorded in `THIRD_PARTY_LICENSES.md`.

## D-007: Wrangler telemetry is off
Wrangler sends anonymous usage data by default. `scripts/setup.ps1` and the CI workflow set `WRANGLER_SEND_METRICS=false`. This matches the project's privacy stance.

## D-008: Name check is partial
- Web search found no link-in-bio product called exactly "Linkbeam". A similar name exists: Linkbee (iOS app).
- npm: `linkbeam` and `@linkbeam/*` are not registered.
- GitHub: could not check. Requests from the build environment were blocked.
- Not checked: trademark registers (WIPO, NIPC Nigeria, USPTO), Google Play, domain availability.

Owner action: check these by hand before public launch. Fallback names if Linkbeam is taken: **Linkglow**, **Bioshine**, **Linkspark**. Changing the name means updating the brand tokens and `docs/BRAND.md`.

## D-009: Zod arrives in Stage 1
The shared package holds brand tokens and the contrast checker for now. Zod schemas are added in Stage 1 together with the endpoints that use them. Adding Zod earlier would be an unused dependency.

## D-010: Frontend uses Astro 7 and Preact 11
These were the current majors at build time. Nothing in Stage 0 depends on a specific feature. Undo: pin older majors if an integration breaks.

## D-011: The Stage 0 "Source code" link is a placeholder
The hello-world page links to `https://github.com/` because the repository does not exist yet. Replace it with the real URL at release.

---

# Stage 1 decisions

## D-012: Avatars are cleaned, not re-encoded or resized
The brief asks for server-side re-encoding. A Cloudflare Worker on the free plan has 10 ms of CPU per request and no image library, so decoding and re-compressing a photo there is not realistic. Instead `apps/api/src/image.ts` identifies the file type from its bytes, then rebuilds the file from known-safe parts only. It drops EXIF/XMP/ICC metadata, comments, animation and any bytes after the end of the image, and rejects anything wider or taller than 4096 pixels. Tests prove metadata and trailing script bytes are gone and the result still decodes.
- **Not done:** resizing. A stored photo can be up to 1 MB. With 5 GB of D1, that is about 5,000 maximum-size photos. Stage 3 will resize in the browser before upload to keep photos small. See `BACKLOG.md` B-001.

## D-013: The API is served on the same host as the site, under /api/v1
The session cookie uses the `__Host-` prefix, which only works for one host. So the site and the API must share a host. In development, Astro proxies `/api` to the Worker on port 8787 (`apps/web/astro.config.mjs`).
- **Open question for Stage 8:** the free `*.pages.dev` and `*.workers.dev` addresses are different hosts. Options are a free Pages Function that forwards `/api/*` to the Worker, or a custom domain with a route. This must be settled before release.

## D-014: Account deletion is a hard delete, so there is no deleted_at column
The brief lists `deleted_at` on users but also requires permanent deletion. Keeping a soft-delete marker would mean keeping personal data. `DELETE /me` removes the user row and foreign keys remove everything attached. Only audit rows remain, with the user id set to null.

## D-015: Additions to the data model and endpoints in the brief
- `avatars` table (follows D-003: photos live in D1).
- `GET /avatar/:key` to serve those photos from their own path with a locked-down content type and `nosniff`.
- `links.message` (WhatsApp prefilled text) and `users.username_changed_at` (username cooldown).
- The brief's `reports.status` values are `open`, `reviewed`, `actioned`, `dismissed`.

## D-016: Stage 1 endpoints are not safe to expose publicly yet
These are deliberately left for Stage 2, as the brief's stage table says: CSRF checks, rate limits (sign-up, magic link, /track, /report), Turnstile, Google/GitHub sign-in, idle session timeout and cleanup of expired tokens. Do not deploy this stage to the internet.

## D-017: "Re-auth" means a sign-in from the last 10 minutes
Export and delete return `401 reauth_required` if the session is older than 10 minutes. The user signs in again with a new magic link.

## D-018: Usernames
- First claim is free. After that, one change per 7 days (HTTP 429 `username_cooldown`).
- A released username can be claimed by anyone straight away. Reserving old names to stop impersonation is on the Stage 6 list (`BACKLOG.md` B-004).
- Reserved words: 59 route and authority names in `packages/shared/src/validators.ts`.

## D-019: Contact links are public by design
A WhatsApp, call or email link shows its number or address on the public page, because that is the feature. The owner's account email is never included, and a test checks this.

## D-020: Token checks use a hash lookup instead of a constant-time compare
Magic-link and session tokens are random 256-bit values. The database is searched by their SHA-256 hash, so the application never compares secrets with `==`. Timing differences could at most leak part of a hash, which cannot be turned back into a token.

## D-021: Compatibility date 2026-08-01
The local Workers runtime in the installed Wrangler supports dates up to 2026-08-06, so `2026-09-01` from Stage 0 failed. Both `wrangler.toml` and the tests now use `2026-08-01`.

## D-022: Zod errors are returned as one short message
The error shape stays `{"error":{"code","message"}}`. For validation errors the message names the first problem, such as `bio: Too big: expected string to have <=160 characters`. These come from the schema, never from user input or the database.

---

# Stage 2 decisions

## D-023: CSRF defence is Fetch Metadata plus an exact Origin match
Every POST, PUT, PATCH and DELETE under `/api/v1` must have an `Origin` equal to `APP_URL`'s origin. If the browser sent `Sec-Fetch-Site`, it must be `same-origin` (or `none`). If there is no `Origin`, the request is accepted only with `Sec-Fetch-Site: same-origin`. This is on top of `SameSite=Lax` cookies and JSON-only bodies, so a plain HTML form cannot send a valid request. The PDF allows "token or Origin check"; Origin was chosen because it needs no token to store and works for the public `/track` beacon too.
- **Side effect:** non-browser clients (curl, scripts) must send an `Origin` header. Documented in the README.
- **Side effect:** in development `APP_URL` must be the site address (`http://localhost:4321`), not the API port.
- Undo: remove `api.use("*", csrfProtection)` in `app.ts`. Not recommended.

## D-024: Sessions end after 14 days idle, or 30 days in total
Migration `0002` adds `sessions.last_seen_at`. A session unused for 14 days is rejected even inside its 30 days. To save D1 writes, `last_seen_at` is refreshed at most once an hour. Existing sessions get `last_seen_at = created_at`, so nobody is signed out by the upgrade (tested). `POST /auth/logout-all` ends every session of the account.

## D-025: Rate limits, and where they are kept
| Counter | Limit | Kept in |
|---|---|---|
| Magic-link requests per IP | 5 per hour | D1 |
| Magic-link emails per address | 3 per hour (silently, still answers 202) | D1 |
| `/report` per IP | 5 per hour | D1 |
| Sign-in callbacks per IP (magic link and OAuth) | 30 per 10 minutes | D1 |
| OAuth starts per IP | 20 per 10 minutes | D1 |
| New accounts per IP | 10 per day | D1 |
| `/track` per IP | 120 per minute | Worker memory |
- D1 counters are one atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement, so parallel requests cannot slip past (tested with 20 at once). Identifiers are stored as SHA-256 hashes.
- `/track` is in memory because a D1 write per click would burn the 100,000 writes/day budget. Each Worker instance keeps its own count, so this slows a script down but is **not a hard guarantee**. Recorded as B-003.
- The numbers are guesses for a small site. Change `DEFAULT_LIMITS` in `ratelimit.ts` if real users hit them.
- The client IP comes from `cf-connecting-ip`, which Cloudflare sets and a visitor cannot forge on a deployed Worker. On localhost anyone can send it, which is how the red-team script varies its address.
- Behind a shared network (a school, one mobile carrier address), several people share one IP and one limit. Accepted.

## D-026: Turnstile fails closed
`/auth/magic-link` and `/report` require a Turnstile token. With no `TURNSTILE_SECRET`, the check passes only when `MAIL_MODE=console` (local development). Forgetting the secret in production therefore blocks sign-ups instead of silently turning the check off. If Cloudflare cannot be reached, the check fails and the visitor can retry. OAuth sign-in has no Turnstile because the provider already does bot defence, and new accounts are capped per IP.

## D-027: Google and GitHub sign-in use Arctic and match accounts by verified email
- Library: Arctic 3.7 (MIT). Google uses PKCE and the `openid email` scopes. GitHub uses the `user:email` scope.
- Accepted only if the provider says the email is verified: Google `email_verified === true`; GitHub the primary address with `verified: true`. Without this, someone could register an unverified address at the provider and take over that person's account.
- A `state` is stored hashed in D1 (10 minutes, single use, tied to the provider) **and** in an HttpOnly `__Host-lb_oauth` cookie. The callback needs both to match, so a link an attacker sends to a victim cannot sign the victim in to the attacker's account.
- The Google ID token is read with `decodeIdToken` without checking its signature. That is acceptable here because it comes straight from Google's token endpoint over TLS in the same request, as OpenID Connect allows. Not acceptable for a token received from a browser.
- There is no `next` or return-address parameter anywhere. Every redirect goes to a fixed address on this site.
- Known gap: B-014.

## D-028: One function finishes every sign-in
`completeSignIn` in `signin.ts` is used by magic links and both OAuth providers. It applies the new-account limit, ban check, a brand-new session id, the cookie and the audit entry in one place, so the three methods cannot drift apart.

## D-029: Daily cleanup by Cron Trigger
`scheduled()` in `index.ts` runs at 03:17 UTC and deletes login tokens expired more than a day ago, expired OAuth states, expired rate-limit rows, and expired or idle sessions. It deletes nothing that is still usable (tested).

---

# Stage 3 decisions

## D-030: What is in Stage 3, and what moved to Stage 4
Built: sign-in page, 3-step setup, the editor with Links, Design, Stats and Settings tabs, live preview, autosave, drag and button reordering, undo for delete, avatar upload with browser-side resize. Settings (username, sign out, sign out everywhere, export, delete) is included because those API endpoints already existed and a signed-in person needs a way out.
- **Moved to Stage 4:** the Share tab (copy link, QR code in PNG and SVG, share buttons, bio tips). It needs the public page to exist first, otherwise it would offer a link that leads nowhere. Backlog B-017.
- The PDF's mobile tab bar lists Links, Design, Stats, Share. Here it is Links, Design, Preview, Stats, Settings. Preview is a tab on narrow screens because there is no room beside the editor. Share joins in Stage 4.

## D-031: Design settings live in the database, with checks in both places
Migration `0003` adds `button_shape`, `font_pair`, `bg_style` and `show_badge` to `users`, each with a SQL `CHECK` so a bad value cannot be stored even if the API had a bug. The API validates them with Zod. Existing accounts get the original look (pill, friendly, plain, badge on).
- The eight theme colour sets live in `packages/shared/src/appearance.ts`, so the editor preview and the Stage 4 public page use the same code. A test checks every theme: text 4.5:1, muted text 4.5:1, button label 4.5:1, button against page 3:1, and the same on the far end of the gradient.
- The accent colour **warns but does not block**. The Design tab says when button text would be hard to read or buttons would blend into the page. The server accepts any `#RRGGBB`. Label colour (dark or white) is chosen automatically for the best contrast. B-008 stays open.
- Two font pairs only: Friendly (Plus Jakarta Sans headings, Inter text) and Clean (Inter for both). Both are already self-hosted, so no extra download.

## D-032: Delete with undo is a delayed delete
Pressing Delete removes the link from the screen and shows "Undo" for 8 seconds. The server delete is sent when the time ends, when another delete starts, before a reorder, or when the page is hidden (sent with `keepalive`). Undo only puts the link back on screen because nothing was deleted yet.
- Safe failure direction: if the browser crashes or loses connection within 8 seconds, the link **stays** (it is not lost).
- No API change was needed. A "restore" endpoint would have meant keeping deleted rows.

## D-033: Autosave rules
- Text edits wait 600 ms after the last key press, then send one request per field group (profile, or one link). Toggles, schedule changes and reordering send at once.
- The header shows Saving, Saved, or "Not saved. Try again". A failed request is kept and retried by the button. A newer edit replaces a failed one.
- The browser warns before closing the tab if something is unsaved.
- A link edit is sent only when the value is valid. Invalid text shows an error tied to its field and is never sent.
- Tested in `apps/web/src/lib/lib.test.ts` (7 cases) and in the browser (a forced network failure, then "Try again").

## D-034: Photos are cropped and shrunk in the browser first
`prepareAvatar` crops to a centred square, scales to at most 512 px and saves a JPEG at quality 0.85. A 3200 x 2000 test photo became a small square well under 100 KB (browser test). The canvas also removes EXIF and location data. The server still cleans and checks every upload (D-012), so this is for size, not for safety. Closes the browser-resize part of B-001. Server-side re-encoding is still not done.

## D-035: Icons
Lucide (ISC) for interface icons. Simple Icons (CC0) for the Google and GitHub marks. Their path data is copied into one file so no extra package is loaded. Sources are in `THIRD_PARTY_LICENSES.md`.

## D-036: How the browser tests run
- `pnpm e2e` runs Playwright (Chromium) against the **real** API (local Workers runtime and a fresh local database) and the real site, on localhost only.
- Sign-in uses the real magic-link flow. The console mailer writes the link to `.e2e/api.log` and the tests read it. No test-only login route exists in the product.
- `pnpm e2e` is separate from `pnpm test` so a normal `pnpm check` needs no browser. CI has its own `e2e` job. Set `CHROMIUM_PATH` to use a Chromium you already have, or run `pnpm exec playwright install chromium` once.
- The site dev server is started through Astro's programmatic API (`tests/e2e/start-web.mjs`) because the `astro dev` command detaches itself when it detects an automated agent, which makes Playwright think it quit.
- Each test person gets a made-up `cf-connecting-ip`, so the per-IP limits from Stage 2 do not mix test people up. This only works on localhost.

## D-037: Accessibility checks are strict
`screens.spec.ts` runs axe-core (WCAG 2.0/2.1 A and AA plus best practices) on 15 screens, at 360x800, 768x1024 and 1440x900, in light and dark. **Any** violation fails the run, not only serious and critical ones, because the PDF's bar (zero serious or critical) should be the floor. It also fails on sideways scrolling, tap targets under 44 x 44 px, and form text under 16 px. A separate test checks 320 px width. The preview phone is excluded from the tap-target check because it is a picture, not controls.

## D-038: First-run setup rules
Setup shows when the account has no username, no links, and the person has not skipped it. "Skip setup" is remembered in the browser (`localStorage`). If storage is blocked, setup simply shows again next time. Skipping leaves a banner that says to choose a username in Settings.

## D-039: Turnstile on the sign-in page
The widget script loads from `challenges.cloudflare.com` only on `/signin`, and only when `PUBLIC_TURNSTILE_SITE_KEY` is set. With no key, no third-party request is made (local development). If the script is blocked, the page says so in plain words. The sign-in button stays off until the page code has loaded, so an early tap cannot reload the page.

## D-040: What the preview does not show
The phone preview shows links that are switched on. It does **not** apply start and end times, so a link scheduled for later still appears. Logged as B-023. The real public page (Stage 4) applies the schedule.

## D-041: The public page is made by the API Worker, as plain HTML
The page people share is `GET /u/:username`, answered by the Worker (`apps/api/src/publicPage.ts`, `routes/page.ts`). It is one HTML string with the CSS inline, no framework and no build step. This gave 0.3 KB of JavaScript, about 78 KB in total with fonts, and a Lighthouse performance score of 99 to 100 (D-049).
- **Free-tier cost (important):** the PDF says public pages should be pre-rendered or edge-cached. This page is rendered per request, so each view counts toward the Workers free limit of 100,000 requests a day (see `FREE_TIER_LIMITS.md`). Each view also sends one `/track` request, so the real ceiling is about 50,000 views a day.
- **Options for Stage 8 (owner's choice):** (a) accept the ceiling, (b) put a free Cloudflare Cache Rule in front of `/u/*` on a custom domain, so cached views never run the Worker (the page already sends `s-maxage=60` and an ETag for this), (c) pre-render pages when they change. Option (b) needs a custom domain. Nothing has been deployed, so nothing is lost by waiting.
- **Routing:** in production the Worker must receive `/u/*` and `/api/*` on the same host as the site (extends D-013). In development Astro proxies both to port 8787.
- Undo: render the page in Astro with the Cloudflare adapter instead. The renderer is a pure function, so it can be moved.

## D-042: The page may run one script, and the browser enforces it
The page has a Content-Security-Policy with `default-src 'none'` and `script-src 'sha256-<hash of our one script>'`. Any other script, even one injected through a bug, is refused by the browser. `style-src 'unsafe-inline'` is allowed because each page carries its own theme colours in a `<style>` block; that cannot run code. All user text is escaped before it enters the page, and addresses are checked again at render time with `linkHref`.
- Mechanism: a route sets `c.set("csp", ...)`. A small middleware registered first runs last and replaces the strict default. This also fixed the photo route, whose own `sandbox` policy had been silently replaced by the default (a test now covers it).
- Tests: `apps/api/test/page.test.ts` (escaping, hash matches the real script, bad addresses refused) and a browser test that tries to add a script and checks it is blocked.

## D-043: Caching of the public page
`Cache-Control: public, max-age=0, s-maxage=60` and an ETag. Shared caches may keep a page for a minute. A browser always checks first (a small 304 reply), so an owner who edits and then opens their page sees the change at once. A first version used `max-age=60` and a browser test showed the owner would see stale pages for a minute; it was changed. The JSON endpoint `/api/v1/u/:username` is unchanged.

## D-044: Share image (Open Graph)
When a page has a photo, the photo is the share image (`twitter:card summary`). Otherwise `og-default.png`, a 1200 x 630 Linkbeam card made by `scripts/make-og.mjs`, is used. There is no per-person generated card: that needs an image library or an external service, which does not fit the 10 ms Worker limit on the free plan. Logged as B-026.

## D-045: QR codes are made in the browser
`qrcode-generator` (MIT) makes the squares. Error correction level M. Always black on white with a 4-square border, because scanners read that best. PNG is about 1,000 px with whole-pixel squares; SVG is a single path. Nothing is sent to any server. The library is loaded only when the Share tab opens. Tests decode the result with a real QR reader (`jsQR`), both in unit tests and on the file the browser downloads.

## D-046: Share buttons are plain links
WhatsApp, Telegram, X, Facebook, LinkedIn and Email open the service's own share address in a new tab. No third-party script is loaded, so nothing tracks the owner. A "Share…" button appears only where the browser supports the native share sheet. Brand icons are not used for these (only generic icons) because the icon set has no brand marks and Simple Icons paths would add more files for little gain.

## D-047: Terms, Privacy and the 90-day security log
Both pages are plain English and describe what the code actually does (checked against the database tables). The security log (`audit_log`) had no end date, so the daily clean-up now deletes entries older than 90 days (`AUDIT_LOG_DAYS`, tested), and the Privacy page says so. The contact address comes from `PUBLIC_CONTACT_EMAIL`; without it the pages point to reports and the repository. **These pages are a careful starting text, not legal advice. The owner should have them reviewed for the countries where Linkbeam will be used.**

## D-048: Landing page and legal pages need no JavaScript
They are static Astro pages with their own small stylesheet (`site.css`). On narrow phones the header shows only "Sign in" (the hero already has the main button), because both did not fit at 360 px. Links inside paragraphs are avoided on the legal pages; they are full-size buttons, so the 44 px touch rule holds everywhere.

## D-049: How Lighthouse is run, and what the numbers mean
`pnpm lighthouse` runs Lighthouse 13.5 against the real local API and site with its standard mobile settings (slow 4G, 4x CPU slowdown), from Playwright's Chromium. The public page is checked on the development proxy (it must come from the Worker); the landing, Terms and Privacy pages are checked from the production build (`astro preview`). The test fails below 95 in any category, above 1.8 s LCP or 0.05 CLS on the public page.
- **Limits:** this is localhost, so real network distance and Cloudflare compression are not included. The preview server does not compress. Treat the scores as a good check of page weight and structure, and repeat them on the live site in Stage 8.

## D-050: One function decides what a button opens
`linkHref` in the shared package turns a kind and a target into the real address (`https://wa.me/<number>`, `tel:`, `mailto:` or a web address), and re-checks the target. WhatsApp supports the optional first message. Stage 5 builds on this (wording in translation files, a browser test for each button type).

## D-051: The public page uses the owner's theme, not the visitor's dark mode
Each of the eight themes is either light or dark and the owner chooses. The page does not switch with the visitor's device setting. The page tells the browser which it is (`color-scheme`), so scroll bars match. An automatic dark version is logged as B-029.


## D-052: Linkbeam has no payment features
The owner's goal is a product that is free of charge and never touches money. So there is no bank-details card, no "Pay me" button, no payment-page link kind, and no card or payment data anywhere. A first version of a bank card was built in Stage 5 and removed before it was released; its database column and code are gone. This matches the v1 non-goal "no in-app payments".

## D-053: One optional "Buy me a coffee" button
The link kind `coffee` replaces `pay`. It only opens the owner's own page on Buy Me a Coffee. It is optional (a page works with none, and the owner can switch it off), and Linkbeam never handles the money. The dashboard shows a placeholder address, `https://buymeacoffee.com/your-name`, and the owner replaces it with their own. Reversible: the kind list lives in `packages/shared/src/validators.ts`.

## D-054: The coffee button accepts only Buy Me a Coffee addresses
The allowed hosts are `buymeacoffee.com`, `www.buymeacoffee.com` and `coff.ee`, over https, with a page name after the host. This keeps the button from becoming a general payment link, and stops look-alike hosts such as `buymeacoffee.com.evil.com`. Reversible if the owner wants other support sites later (B-034).

## D-055: Migration 0004 turns old payment links into web links
SQLite cannot change a CHECK rule in place, so `migrations/0004_coffee_kind.sql` rebuilds the `links` table. Any old `pay` link becomes an ordinary `url` link (it was already an https address), so no link is lost. Statistics are copied aside during the rebuild, because dropping the old table would otherwise delete them through the cascade rule. A test checks that links and statistics survive and that the cascade rule still works.

## D-056: Stricter address checks and translation files (Stage 5)
Each link kind has its own checker. Map accepts a web link or a plain address (turned into a map search link). Email refuses extra parts such as `?cc=`. WhatsApp and call accept international numbers only. WhatsApp can carry a first message. A fuzz test tries 4,000 strange strings on every kind. Words that visitors and the link editor read live in `packages/shared/src/i18n/en.ts` (see `docs/TRANSLATING.md`).

## D-057: Look-alike names are blocked by a "skeleton" check
Reserved words are compared after removing `-` and `_` and treating look-alike characters as equal (`1`, `i`, `l`; `0`, `o`; `rn`, `m`). It can block a rare honest name that looks like a reserved word. Undo: remove `usernameSkeleton` from `checkUsername` in `packages/shared/src/validators.ts`.

## D-058: Hidden and direction-changing characters are refused in text
Names, bios, titles and messages may not contain control characters, zero-width space, direction marks or line separators. Emoji joiners stay allowed. Undo: remove the `isPlainText` refinements in `schemas.ts`.

## D-059: The public page allows styles by hash, the website by Astro's hashes
No `unsafe-inline` for scripts or style blocks anywhere. The website allows inline style attributes only (Preact sets some). Cloudflare Turnstile is the only outside script. Zod runs in plain mode in browsers so the policy needs no `unsafe-eval`.

## D-060: Database changes that need the whole row use a "same as I read" condition
Username changes name the username and cooldown time they read in the `WHERE` clause, so parallel requests cannot all pass the check. The same idea can protect other read-then-write paths later.

## D-061: Test tooling is pinned to patched versions
`pnpm-workspace.yaml` overrides `undici` and `sharp` because Miniflare brought vulnerable copies (dev only). Remove the overrides once Miniflare ships patched ones.

## D-062: One Worker serves the website and the API (settles D-013 and the open question for Stage 8)
`apps/api/wrangler.deploy.toml` serves the built website as Workers static assets, and runs the Worker first only for `/api/*` and `/u/*`. The site and API share one free `*.workers.dev` address with no custom domain and no Pages Function. Checked on a local copy of the runtime: pages, API, public pages, the 404 page and the `_headers` file all answered correctly. Static file requests do not run the Worker, so the daily request budget is the same as before (B-027). Local development keeps `wrangler.toml`, so it does not need the site built first. Undo: deploy the website to Cloudflare Pages and forward `/api/*` and `/u/*` to the Worker with a route on a custom domain.

## D-063: A real email sender was missing, so Stage 7 added Brevo
Until now only a console mailer and a "send nothing" mailer existed, so a live site could not send sign-in links. `brevoMailer` calls Brevo's transactional API (free plan) and needs `BREVO_API_KEY` (secret) and `BREVO_SENDER_EMAIL`. It never logs the address, the link or the reply body, and a failure looks the same as a success to the visitor (as before). If `MAIL_MODE=brevo` but a setting is missing, nothing is sent and the log says why. Tested with a stubbed network only: **not** tested against real Brevo (see `NOT_TESTED.md`). Undo: write another `Mailer` (Resend is the fallback in D-002).

## D-064: Offline support keeps it small and private
- The service worker (`apps/web/public/sw.js`) saves only the page shell. Pages: network first, so a new release shows at once. Hashed files, fonts and icons: saved copy first. It never touches `/api/`, `/u/` or any request that is not GET, and saves only plain, successful, same-origin answers.
- It is registered only in production builds, from the dashboard.
- Offline edits cover things that already exist (link text, addresses, show/hide, dates, profile text, design). Adding, deleting and reordering links, the photo and the username need the server, and the screen says so (B-041).
- A copy of the profile and links ("snapshot") and the unsent edits ("drafts") live in `localStorage`, are checked with the same rules as the server on every read (damaged or edited storage is dropped, never trusted), belong to one account, and are removed at sign-out and account deletion. After sign-out nothing can be written again.
- Why not IndexedDB or Background Sync: more code, and Background Sync does not exist in Safari. The page sends the edits itself when the browser says it is online again.
- Cost: personal data (email, names, links) sits in the browser on that device until sign-out. This is the normal trade-off of offline apps. On a shared computer, sign out.

## D-065: Website pages are built as files
`build.format: "file"` makes `/dashboard` a file (`dashboard.html`). With folders, Cloudflare redirected `/dashboard` to `/dashboard/`, and a browser will not show a redirected answer for an offline page visit. Undo: switch back to folders and make the service worker follow redirects.

## D-066: Licence rule for dependencies
`scripts/licenses.mjs` allows permissive licences (MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak, CC0, OFL) and fails on anything else unless it is explained in the script and in `THIRD_PARTY_LICENSES.md`. Three are explained: LGPL (sharp's image library, build machine only), MPL-2.0 (lightningcss and axe-core, not shipped) and CC-BY-4.0 (browser data, build time only). The Worker bundle was checked and holds none of them.

## D-067: A visitor never sees raw error text on a public page
If the server fails while making `GET /u/:username`, it answers with a small friendly HTML page (status 500, not cached, same strict policy as other public pages). API routes still answer with JSON errors. No technical detail is shown in either case.

## D-068: Honest limits of the docs
The deploy guide has no Cloudflare or Brevo screenshots (they need real accounts, B-040). `CODE_OF_CONDUCT.md` and `SECURITY.md` carry placeholder contact addresses that the owner must replace (B-037). Terms and Privacy stay templates (B-030).

## D-069: fast-uri is pinned to a patched version (dev only)
On 2026-10-24 `pnpm audit` reported 4 new advisories (2 moderate, 2 low) in `fast-uri`, which only the Astro language server (`@astrojs/check`, type checking) uses. `pnpm audit --prod` stayed clean, and nothing from it is deployed. `pnpm-workspace.yaml` now requires `fast-uri >=3.1.9`. Remove the override once the language server ships a patched copy.

## D-070: The API tests get a 30-second time budget
A fresh-clone run failed once because a security test that sends 150 requests one after another took 5.1 seconds against vitest's 5-second default. Several other tests (50 parallel requests against a real local database) took 3 to 4.7 seconds. `apps/api/vitest.config.ts` now sets `testTimeout` and `hookTimeout` to 30 seconds. No test is retried and no assertion changed. Checked with three full API runs at the same time on one machine: 324 of 324 passed each, and the slowest test took 14.9 seconds.

