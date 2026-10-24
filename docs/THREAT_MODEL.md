# Threat model

Written in Stage 6. Update it whenever the design changes. This is a model, not a proof: see the honesty section of `SECURITY_REPORT.md`.

## What we protect (assets)

| Asset | Why it matters |
|---|---|
| A person's account (email, sign-in) | Taking it over lets someone change or delete a page that belongs to someone else |
| Page content (name, bio, links, photo) | Visitors trust it. A changed link can send them to a scam |
| Visitors' safety | A public page must never run a stranger's script or send people to a dangerous address |
| Private owner data (email, statistics, export) | Only the owner may see it |
| Service availability | A free service on free tiers can be knocked over cheaply |
| The owner's free-tier quotas | Cloudflare and email limits are the budget (see `FREE_TIER_LIMITS.md`) |
| The secrets | Sign-in signing keys, email API key, Turnstile secret, OAuth secrets |

Linkbeam holds no payment data (D-052) and no passwords.

## Who might attack (actors)

1. **A visitor with bad intent**: anonymous, can request any public address.
2. **A signed-in user**: can call every API with their own session, and may target another user.
3. **A page owner who abuses the service**: phishing pages, impersonation, spam links.
4. **A remote attacker with a victim's email address** (not their inbox): tries to lock them out or sign in as them.
5. **A supply-chain attacker**: poisoned package or build tool.
6. **A mistake by the owner**: a leaked secret, a wrong setting.

Out of scope: an attacker who controls Cloudflare, the owner's computer or the victim's mailbox.

## Entry points

- Public: `GET /u/:username` (HTML), `GET /api/v1/u/:username`, `GET /api/v1/avatar/:key`, `POST /api/v1/track`, `POST /api/v1/report`, `POST /api/v1/auth/magic-link`, `GET /api/v1/auth/callback`, OAuth start and callback, static website pages.
- Signed in: profile, links, order, avatar upload, statistics, export, delete account, log out.
- Build and supply chain: npm packages, GitHub Actions.

## Top 10 threats and mitigations

| # | Threat | Mitigation | Tested by |
|---|---|---|---|
| 1 | **Account takeover** by guessing or replaying a sign-in link or session | 256-bit single-use tokens, 15-minute life, stored hashed; sessions rotated on sign-in; cookie `__Host-`, HttpOnly, Secure, SameSite=Lax; idle and absolute limits; per-IP and per-email limits | `auth.test.ts`, `auth-hardening.test.ts`, `redteam-injection.test.ts` (cookie flags), live script round 1 |
| 2 | **Reading or changing another user's data** (IDOR, mass assignment) | Every query is filtered by the session's user id; unknown fields are ignored; ids are random; the same 404 for "not yours" and "not there" | `ownership.test.ts`, `redteam-access.test.ts` |
| 3 | **Script in a visitor's browser** (stored or reflected XSS) | All user text is escaped at output; the public page has a policy that allows exactly one script (hashed); hidden and direction-changing characters are refused; the website has a hashed-script policy | `redteam-injection.test.ts`, `page.test.ts`, `csp.spec.ts` |
| 4 | **Dangerous links** (`javascript:`, `data:`, look-alike schemes) | One function builds every address; each kind has its own checker; checked at save and again at render | `linkValidation.test.ts` (4,000-string fuzz), `redteam-injection.test.ts` |
| 5 | **Cross-site request forgery** | Fetch Metadata plus exact Origin check on every change; JSON-only bodies; SameSite cookie | `auth-hardening.test.ts` |
| 6 | **SQL injection** | Every query uses bound parameters; a lint rule fails any string-built SQL | `sql-lint.test.ts`, `redteam-injection.test.ts`, sqlmap |
| 7 | **Malicious uploads** | Only JPEG, PNG and WebP; re-written without metadata or trailing bytes; size and dimension limits; random storage key; served with `sandbox` policy and `nosniff` | `image.test.ts`, `me.test.ts`, `redteam-injection.test.ts` |
| 8 | **Overload and free-tier exhaustion** | 16 KB body limit; per-IP limits on sign-in, report, track; Turnstile on sign-in and report; cached public pages | `redteam-injection.test.ts`, `redteam-race.test.ts` |
| 9 | **Impersonation and squatting** | Reserved words plus look-alike check (`adm1n`, `ad-min`); hidden characters refused; username change once per 7 days (race-proof); 30 links per user; report button | `redteam-access.test.ts`, `redteam-race.test.ts` |
| 10 | **Supply chain and secrets** | Lockfile and frozen installs; patched pins; gitleaks, pnpm audit and Semgrep results recorded; no secrets in the repository; Dependabot | scanner summary in `SECURITY_REPORT.md` |

## Added in Stage 7

| New thing | Risk | What limits it |
|---|---|---|
| Service worker | It could keep another person's data, or serve an old or poisoned page | Saves only same-origin GET answers that are plain and successful. Never saves `/api/` or `/u/`. A browser test checks that nothing personal is in the saved files. The worker file is not cached (`no-cache`) so a fix reaches people. |
| Data on the device (`localStorage`) | Another person using the same browser could read it; damaged data could break the app | Removed at sign-out and account deletion, with no later writes. Drafts of another account are ignored. Everything read back is checked with the server's rules. On a shared computer, sign out. |
| Brevo email sender | A leaked key could send mail as you; a log could leak addresses or links | The key is a Worker secret, never in files. Only the status number is logged. The link is escaped in the HTML part. |
| One Worker for site and API | A mistake in routing could send a page to the wrong place | Only `/api/*` and `/u/*` run the Worker first. Everything else is a file. Checked locally; the live edge is a Stage 8 check (B-038). |

## Known gaps (accepted for now)

See the findings with status "accepted" in `SECURITY_REPORT.md`: sign-in quota can be used up by a stranger for one hour (SL-001), a magic link signs in whoever opens it (SL-002), view and click counts can be inflated by someone with many addresses (SL-007), and a deleted account's anonymous security-log lines stay for 90 days (SL-014).

## When the design changes

Add the new entry point to the table above, think through the ten threats against it, add a test, and note it in `DECISIONS.md`.
