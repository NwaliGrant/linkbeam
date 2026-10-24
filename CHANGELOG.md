# Changelog

All notable changes to Linkbeam are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Version 1.0.0 is tagged at release (Stage 8).

## [Unreleased]

## [1.0.0] - not yet tagged

The first release. `v1.0.0-rc.1` is the release candidate: everything is built and tested on a developer machine, but it has **not** been deployed, and the checks in `docs/NOT_TESTED.md` are still open. Tag `v1.0.0` only after `docs/RELEASE_CHECKLIST.md` steps 5 and 6 pass, and put the date here.

### Added
- `scripts/smoke.mjs`: a read-only smoke test for a deployed site (15 checks: pages, security headers, 404 pages, signed-out and cross-site refusals, no technical detail in errors).
- `.github/workflows/release.yml`: on a `v*` tag, re-runs every check, then (after approval) applies migrations, deploys, smoke-tests the live site and publishes these notes.
- `docs/RELEASE_CHECKLIST.md`: what is done and what only the owner can do.
- **Installable app (PWA).** The dashboard can be added to a phone's home screen. It has a manifest, icons (including a maskable one for Android) and a service worker that saves only the page shell. Your data is never stored by the worker.
- **Offline editing.** The dashboard opens without a connection. Edits to existing links, the profile and the design are kept on the device and sent when the connection returns. They are removed when you sign out. Adding, deleting and reordering links, your photo and your username still need a connection, and the screen says so.
- **Friendly errors.** A clear message with "Try again" when the server is down, a plain 404 page for the website, and a friendly page (not raw text) when a public page fails.
- **Sign-in email through Brevo** (free plan). Before this, only a developer console mailer existed, so a live site could not send sign-in links. A missing setting is reported in the log, and the address and link are never logged.
- **One-Worker deployment** (`apps/api/wrangler.deploy.toml`): the website and the API are served from one free Worker on one address. See D-062.
- Community files: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, `docs/SELF_HOSTING.md`, issue and pull request templates, brand and trademark rules, logo files.
- `scripts/licenses.mjs`: checks the licence of every dependency (575 packages) and fails on an unexplained one.
- `docs/NOT_TESTED.md`: everything that still needs a human check on a real phone, inbox or Cloudflare account.

### Changed
- Website pages are built as files (`/dashboard`, not `/dashboard/`), so the host serves them without a redirect.
- The Privacy page now explains the copy kept on the device for offline use.
- Landing page and empty-state wording no longer mention payments (left over from before Stage 5).

### Fixed
- A damaged or edited saved copy on the device could crash the dashboard on every start. Everything read back from the device is now checked with the server's rules, and invalid data is dropped.
- Offline drafts could be written again after sign-out by a save that was still on its way. A guard now blocks every write after sign-out, and a browser test proves it.

### Security
- Stage 6 red team: 12 findings (8 fixed, 4 accepted and written down), a content security policy on every website page, no `unsafe-inline` for scripts or style blocks. See `docs/SECURITY_REPORT.md`.

### Earlier stages in this release
Stages 0 to 6 (foundation, data and API, sign-in, dashboard, public page, business buttons, red team) are listed below.

- **Stage 6**: red-team pass, fixes, threat model, security policy.
- **Stage 5**: business buttons (website, WhatsApp, Buy me a coffee, call, email, map). No payment features.
- **Stage 4**: fast public page, share tools and QR code, click and view counts.
- **Stage 3**: dashboard with autosave, reorder, themes and live preview.
- **Stage 2**: sign-in (email link, Google, GitHub), sessions, CSRF protection, rate limits.
- **Stage 1**: database, validation and API.
- **Stage 0**: repository, tooling, CI and brand tokens.
