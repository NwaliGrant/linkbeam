# Security report

Written as the red team goes. Stage 6 completes it. Rules of engagement: attacks run only against the app on this machine (localhost) or the owner's own staging. `scripts/redteam/round1.mjs` refuses to run against any other host.

**Honest status (end of Stage 6):** every row of the 15-row checklist was attacked, findings were fixed and re-attacked, and the scanners ran (two could not, see "Not tested"). This is **not** a claim that Linkbeam is unhackable. An independent human review is recommended before real users arrive. The "Not tested" section lists what was not covered.

## Round 1 (Stage 2): checklist 2, 3 and 7

Tools: hand-written Vitest attack cases (`apps/api/test/auth-hardening.test.ts`, `oauth.test.ts`) and a live script against `wrangler dev` (`scripts/redteam/round1.mjs`, output in `docs/evidence/stage2-redteam-round1.log`).

| # | Attack | Result | Evidence |
|---|---|---|---|
| 2 | Reuse a magic link | Pass: rejected | `auth.test.ts` "works only once", 50 parallel uses, only one wins |
| 2 | Use an expired link | Pass | `auth.test.ts`, 15-minute edge both sides |
| 2 | Brute-force tokens | Pass: 30 attempts per 10 min per IP, then 429. Tokens are 256 bits, so guessing is not realistic anyway | live script: 30 redirects, 15 x 429; test with 40 guesses |
| 2 | Replay a link after logout | Pass: link is dead, old cookie is dead | `auth-hardening.test.ts` |
| 2 | Session fixation | Pass: new session id on every sign-in, planted cookie ignored | `auth.test.ts` |
| 2 | Tamper with the cookie | Pass: 8 variants (changed, cut, doubled, empty, 5 KB, wrong name, upper-cased, SQL text) all 401 | `auth-hardening.test.ts` |
| 2 | Idle and absolute session life | Pass: 14 days idle or 30 days total | `auth-hardening.test.ts` |
| 2 | OAuth: attacker's state sent to victim; no cookie; invented state; expired; wrong provider; unverified email | Pass: all refused | `auth-hardening.test.ts`, `oauth.test.ts` |
| 3 | Compare magic-link answers for existing, new, banned, differently-cased emails | Pass: byte-identical status, body and header names | test, and live script |
| 3 | Compare timing for existing and unknown emails | Pass: 40 pairs, medians 11.3 ms and 11.4 ms, ratio 1.00. The handler never looks the user up, which is why | live script |
| 3 | Over-limit email vs normal | Pass: same answer | test |
| 3 | Bad callback token for existing vs unknown account | Pass: same redirect | test |
| 3 | Username taken vs reserved vs malformed vs free | Pass for signed-out visitors: the last three look identical. A taken name shows its public page, which is the product | test |
| 3 | Report existing vs missing page | Pass: same answer | test |
| 7 | Cross-site Origin, `null` Origin, lookalike origins, http vs https, `Sec-Fetch-Site` cross-site and same-site, no Origin | Pass: 403 on all 9 state-changing endpoints x 8 variants | `auth-hardening.test.ts` (72 requests) and live script |
| 7 | Cross-site HTML form delete of account | Pass: 403, account intact | test, live script |
| 7 | Logout CSRF | Pass: blocked, session intact | test |

Not tested in this round: user enumeration through **timing at the database level on sign-up by OAuth** (provider answers differ by nature), and enumeration by username availability inside the signed-in dashboard (Stage 3).

### How strong are the tests? (mutation checks)
Ten deliberate code breaks were made one at a time. Each was caught by at least one test: Origin check removed, Fetch Metadata check removed, OAuth state-cookie compare removed, per-email limit removed, idle timeout removed, new-account limit removed, Google `email_verified` check removed, GitHub `verified` check removed. Two of the ten first **survived**, which showed my tests were weak (a fake provider that hid the cookie check, and no test of the real Google/GitHub code). Both were fixed and re-run; all now fail as they should.

## Findings

### SL-001: A stranger can use up someone's magic-link quota (sign-in lockout)
- **Severity:** Low. Impact is a temporary denial of sign-in for one person; likelihood needs an attacker who knows the email and repeats every hour.
- **Hat and tool:** hand-crafted request, reasoning about D-025.
- **Reproduction:** send 3 magic-link requests for `victim@example.com` (each from a different IP, or within 5 per IP per hour). The 4th and later requests for that address send nothing for the rest of the hour. Seen in test "limits one inbox to 3 emails an hour".
- **Root cause:** the per-address limit that stops inbox flooding also lets anyone spend the victim's allowance.
- **Fix:** not fixed. Accepted for now. Google and GitHub sign-in are a way in that this cannot block, and the lockout lasts at most one hour. Logged as B-015.
- **Regression test:** the behaviour is pinned by the test above, so a change must be deliberate.
- **Re-attack result:** n/a (accepted risk).

### SL-002: Login CSRF through a magic link
- **Severity:** Low. An attacker can sign a victim in to the attacker's own account by tricking them into opening the attacker's link. Nothing of the victim's is exposed, but the victim might then enter data into the attacker's account.
- **Hat and tool:** reasoning. Inherent to magic links.
- **Reproduction:** attacker requests a link to their own address, sends the URL to the victim, victim opens it.
- **Root cause:** a magic link signs in whoever opens it.
- **Fix:** not fixed. The dashboard (Stage 3) should show the signed-in email clearly. Logged as B-016.
- **Regression test:** none yet.
- **Re-attack result:** n/a.

### Gap closed by design: no CSRF protection in Stage 1
Stage 1 had no CSRF check (D-016 said so openly). Stage 2 adds it (D-023). I did **not** re-run the attack against Stage 1 code to prove it was exploitable, so this is recorded as a known gap closed, not as a tested finding.


---

# Stage 6: the full attack pass

Rules of engagement followed: every attack ran against the app on this machine (unit-level harness with a throwaway database, or `wrangler dev` on 127.0.0.1 with a throwaway database). No third-party site, account or data was touched. `scripts/redteam/seed-live.mjs` refuses any host that is not localhost.

Tools: hand-written attack tests (`apps/api/test/redteam-access.test.ts`, `redteam-injection.test.ts`, `redteam-race.test.ts`, `tests/e2e/csp.spec.ts`), sqlmap, OWASP ZAP 2.16.1 (passive and 6-minute active scan), Semgrep community rules, gitleaks 8.28, `pnpm audit`. Scanner output is in `docs/evidence/stage6/`.

## Checklist results

| # | Attack | Result | Evidence |
|---|---|---|---|
| 1 | IDOR on every link endpoint, encoded and traversal ids, mass assignment (`is_banned`, `user_id`, `id`, `email`, `role`...), reorder with foreign ids, stats and export parameters | **Pass.** 404 in the same shape as a missing id; extra fields ignored and never stored | `redteam-access.test.ts`, `ownership.test.ts` |
| 2 | Token reuse, expiry, brute force, replay, fixation, cookie tampering; cookie flags | **Pass** (round 1) plus cookie `__Host-`, HttpOnly, Secure, SameSite=Lax, no Domain | round 1, `redteam-injection.test.ts` |
| 3 | User enumeration (responses and timing) | **Pass** (round 1) | round 1 |
| 4 | XSS: 14 payloads in name, bio, link title, WhatsApp message; reflected through path, query, headers, error messages; script-like report reason; policy check in a real browser | **Pass** on the public page (one hashed script, everything escaped). **Fail on the website pages**: no content security policy (SL-008) and a policy-violation noise from Zod (SL-013). Both fixed | `redteam-injection.test.ts`, `csp.spec.ts`, ZAP |
| 5 | Dangerous schemes: 48 hostile addresses (`javascript:` with tab/newline/zero-width/full-width/Cyrillic tricks, `data:`, `vbscript:`, `//host`, `\\host`, userinfo, 2,100-character URLs) on every kind, plus damaged rows written straight into the database | **Pass.** Refused at save; where an address is kept it is plain http/https; render re-checks | `redteam-injection.test.ts`, `linkValidation.test.ts` fuzz |
| 6 | SQL injection: 14 payloads in every text field, path, id and query parameter; sqlmap on 6 endpoints (level 3) | **Pass.** Text stored and returned unchanged, tables untouched, no 5xx. sqlmap: not injectable. ZAP active scan found none | `redteam-injection.test.ts`, sqlmap logs, `sql-lint.test.ts` |
| 7 | CSRF | **Pass** (round 1) | round 1 |
| 8 | Open redirect, host-header and forwarded-host tricks, server-side fetch | **Pass.** Redirects ignore 7 parameter names and 4 hostile values; forged `Host` and `X-Forwarded-Host` change nothing; no outbound fetch is triggered by any user input | `redteam-access.test.ts` |
| 9 | Uploads: SVG with script, HTML as PNG, polyglot with appended script, GIF/BMP/ICO/PDF/zip, empty file, header lying about a 60000x60000 picture, 7 hostile file names, 3 MB file, lying Content-Length, 200 form parts | **Pass.** Re-written or refused; script bytes are gone; stored under a random key; served with `nosniff` and `sandbox` | `redteam-injection.test.ts`, `image.test.ts` |
| 10 | Overload: bodies over 16 KB (declared and streamed), JSON nested 7,000 deep, huge numbers, odd shapes, hammering magic-link, report and track | **Pass.** 413 or 400 in well under 5 seconds; 429 with `Retry-After` | `redteam-injection.test.ts` |
| 11 | Analytics poisoning: a foreign link id under someone else's page, disabled and unknown links, 150 beacons from one address, extra fields | **Partly.** Cross-page and disabled-link tricks are not counted; one address is stopped at 120 a minute. Many addresses can still inflate counts (SL-007, accepted) | `redteam-access.test.ts` |
| 12 | Framing and headers on 7 kinds of answer; ZAP | **Pass on the Worker.** Website headers come from Cloudflare Pages `_headers`: file content is tested, but live headers are checked after deploy (Stage 8) | `redteam-injection.test.ts`, `csp.spec.ts`, ZAP |
| 13 | Secrets and dependencies | **Pass after fixes.** gitleaks: clean on all 21 commits and on all tracked files (one false alarm, SL-012). `pnpm audit`: 17 findings in test tooling, fixed by pinning (SL-011), now 0. Build output and the Worker bundle contain no secrets. OSV-Scanner could not run (see Not tested) | `evidence/stage6/` |
| 14 | Squatting and look-alike names, 31st link, username cycling, rename leaves old page, hidden characters | **Fail, fixed.** Look-alikes (SL-003), hidden characters (SL-004) and a race on the 7-day limit (SL-005) | `redteam-access.test.ts`, `redteam-race.test.ts` |
| 15 | Privacy: public JSON and HTML scanned for email, ids, timestamps, schedule; error bodies for internals; full deletion | **Pass**, with one **Fail, fixed**: sign-in tokens kept the email after deletion (SL-010). One accepted note (SL-014) | `redteam-access.test.ts` |

## Race conditions (50 parallel requests)

| Attack | Result |
|---|---|
| 50 people claim one username | Exactly 1 wins, 49 get 409 (also with mixed letter case) |
| 1 person changes username 50 times at once | **Fail first** (all 50 succeeded), fixed (SL-005): now exactly 1 |
| 50 link creations | Exactly 30 created, 20 refused, positions 0 to 29 |
| 25 links then 50 creations | Exactly 5 added |
| 50 deletions of one account | At least one 204, the rest 401, nothing left in any table |
| Link creation while the account is deleted | **Fail first** (a 500 error), fixed (SL-006). No orphan row was ever left |
| 50 parallel reorders | Numbering always 0 to n-1 |
| 50 parallel beacons | Exactly 50 counted |

## Findings

### SL-003: Look-alike usernames could be claimed (`adm1n`, `ad-min`, `linkbeam-`, `linkbearn`)
- **Severity:** Medium. Impact: a stranger could pose as the service or support on a page that carries the project's name; likelihood: high, no skill needed.
- **Hat and tool:** hand-crafted request, 19 look-alike names.
- **Reproduction:** `PATCH /api/v1/me {"username":"adm1n"}` with a signed-in session returned 200 (18 of 19 names were accepted).
- **Root cause:** the reserved list matched exact words only.
- **Fix:** a "skeleton" of each name (no `-` or `_`, `1`/`i`/`l` equal, `0`=`o`, `rn`=`m`, and so on) is compared with the skeletons of the reserved words; 11 more reserved words were added. Commit `8decf31` (`packages/shared/src/validators.ts`).
- **Regression test:** `redteam-access.test.ts` "reserved names and their look-alikes cannot be claimed", `validators.test.ts` "look-alike usernames".
- **Re-attack result:** all 19 refused. Variations tried: other digit swaps (`4dmin`, `r00t`), added separators (`a-d-m-i-n`), trailing separator (`support_`): refused. Ordinary names that contain a reserved word (`ada-designs`, `adminfan`) still work.

### SL-004: Hidden and direction-changing characters accepted in names, bios and titles
- **Severity:** Medium. A right-to-left override or a zero-width character makes one person's name look like another's, or hides text.
- **Hat and tool:** hand-crafted request.
- **Reproduction:** `PATCH /api/v1/me {"display_name":"Ada<U+202E>evil"}` returned 200 and the page showed reversed text.
- **Root cause:** only length was checked.
- **Fix:** `isPlainText` refuses control characters, soft hyphen, zero-width space, directional marks and isolates, line and paragraph separators and byte-order marks in display name, bio, link title and WhatsApp message. Line breaks are allowed only in bio and message. The zero-width joiner and non-joiner stay allowed because emoji and several scripts need them. Commit `8decf31` (`schemas.ts`, `validators.ts`).
- **Regression test:** `redteam-access.test.ts` "display names and titles cannot hide text direction tricks", `validators.test.ts`.
- **Re-attack result:** 9 tricks refused on all 3 fields (27 requests). Variations: character in the middle, at the end, at the start (JavaScript trims some), as an emoji sequence (allowed).

### SL-005: The 7-day username limit could be beaten with parallel requests
- **Severity:** Medium. Impact: cycling through names to impersonate; likelihood: needs a short script.
- **Hat and tool:** 50 parallel `fetch` calls (Vitest).
- **Reproduction:** with a username changed more than 7 days ago, send 50 `PATCH /api/v1/me` with different usernames at once: all 50 returned 200.
- **Root cause:** the cooldown was read, checked and then written in separate steps.
- **Fix:** the update now names the username and cooldown time it read in its `WHERE` clause. A request that lost the race changes nothing and gets 409 (or 401 if the account is gone). Commit `8decf31` (`apps/api/src/routes/me.ts`).
- **Regression test:** `redteam-race.test.ts` "one person changing their username 50 times at once".
- **Re-attack result:** exactly 1 of 50 succeeds. Variations: first claim plus 49 changes at once; same name in 4 letter cases from 20 users.

### SL-006: Creating a link while the account is being deleted returned a 500 error
- **Severity:** Low. No data was left behind (the database refuses a link without an owner) but the person saw "Something went wrong" and an error was logged.
- **Hat and tool:** 50 parallel link creations with one deletion in the middle.
- **Root cause:** the foreign-key error was not handled.
- **Fix:** the error is turned into a 401, and a missing row after insert also becomes 401. Commit `8decf31` (`routes/links.ts`, `routes/me.ts`).
- **Regression test:** `redteam-race.test.ts` "creating links while the account is being deleted never leaves a link behind".
- **Re-attack result:** no 5xx and no orphan row in 3 repeated runs.

### SL-007: Views and clicks can be inflated by an attacker with many addresses
- **Severity:** Low. Impact: wrong numbers on one owner's stats; no data access, no money. Likelihood: needs many IP addresses.
- **Hat and tool:** 150 beacons from one address (stopped at 120 a minute), reasoning about the rest.
- **Root cause:** `/track` uses an in-memory limiter. Each Worker instance has its own memory, so the real limit is higher than 120 a minute per address. Public counting also cannot tell a person from a script by design.
- **Fix:** not fixed. **Accepted** with the reason above. Logged as B-035 (use Cloudflare's free rate-limiting binding or a D1 counter, and a daily sanity cap per page).
- **Regression test:** `redteam-access.test.ts` pins the per-address limit and the cross-page rules.
- **Re-attack result:** n/a (accepted risk).

### SL-008: The website pages had no content security policy
- **Severity:** Medium. Pages with sign-in and the dashboard had no second line of defence against an injected script. ZAP: "CSP header not set", 9 instances.
- **Hat and tool:** OWASP ZAP passive scan; then a Playwright script that injects a script, an event handler and a foreign script.
- **Root cause:** a policy was set for the Worker only.
- **Fix:** Astro's built-in policy support adds a `<meta>` policy with hashes of its own scripts and styles. Allowed: own files, Cloudflare Turnstile only. `frame-ancestors 'none'` is added to `_headers` because a `<meta>` policy cannot set it. Commit `b131ce4` (`apps/web/astro.config.mjs`, `public/_headers`).
- **Regression test:** `tests/e2e/csp.spec.ts` (7 tests, on the production build).
- **Re-attack result:** an injected inline script, an injected `onerror` and a script from `evil.example` are all blocked on all 6 pages, and the pages' own scripts and styles run with zero violations.

### SL-009: The public page allowed any inline style
- **Severity:** Low. A style injection could change how a page looks but not run script. ZAP: "CSP: style-src unsafe-inline", Medium (High confidence) on its scale.
- **Root cause:** the owner's theme is written into a `<style>` block, so the policy allowed `'unsafe-inline'`.
- **Fix:** each response now lists the SHA-256 hash of its own style block. There is no `unsafe-inline`. Commit `b131ce4` (`apps/api/src/routes/page.ts`).
- **Regression test:** `redteam-injection.test.ts` "the page's policy allows only our one script": the hash must equal the page's real style block, the page has one style block and no `style=` attributes.
- **Re-attack result:** ZAP was run again on the fixed Worker (3-minute active scan, `docs/evidence/stage6/zap-active-after-fix.json`): the style alert is gone, and only the expected "timestamp" and "user agent fuzzer" notes remain. The page still renders in the browser (all public page browser tests pass).

### SL-010: A deleted person's email stayed in the sign-in token table
- **Severity:** Low (privacy). The address stayed until the daily cleanup, up to about a day.
- **Fix:** deleting an account also deletes that address's sign-in tokens, in the same batch. Commit `8decf31` (`routes/me.ts`).
- **Regression test:** `redteam-access.test.ts` "deleted accounts leave no email in sign-in tokens".
- **Re-attack result:** none left.

### SL-011: Vulnerable copies of `undici` and `sharp` inside the test tool Miniflare
- **Severity:** Medium by the advisories (5 high), but **dev-only**: they run on a developer's machine and in CI, never in the deployed Worker. `pnpm audit --prod` was already clean.
- **Fix:** `overrides` in `pnpm-workspace.yaml` pin `undici >= 7.29.1` and `sharp >= 0.35.5`. All 316 API tests and 69 browser tests still pass. Commit `8decf31`.
- **Re-attack result:** `pnpm audit`: No known vulnerabilities found.

### SL-012: gitleaks false alarm (Info)
- One hit in history: a test listing migration file names beside a short word. Not a key. Allow-listed by commit and path in `.gitleaks.toml`. A full scan of all 21 commits and of all tracked files is clean.

### SL-013: Zod tried to compile code in the browser (Info, fixed)
- Under the new policy the browser logged a violation, because Zod 4 tests whether it may use `new Function`. It fell back correctly, but a clean policy should log nothing. Fixed by switching Zod to its plain mode in browsers only (`packages/shared/src/schemas.ts`). The Worker keeps the fast mode. Regression: `csp.spec.ts` expects zero violations.

### SL-014: Anonymous security-log lines outlive a deleted account for 90 days (Info, accepted)
- The log keeps the action and a salted, daily-rotating hash of the address, with the user id removed on deletion. The Privacy page states the 90-day period. No email is kept (tested). Accepted.

### Scanner notes
- **Semgrep:** 168 notes. 118 are "text not translated" hints (B-032, not security). 30 "HTML in template string" are the public page and QR code builders; each interpolation was checked and goes through `esc()` or is a fixed value or validated enum/hex (tested with 14 payloads). 7 "template string" hints, 3 robots hints, 2 jQuery-style `.html` hints on Hono's `c.html` (server render, not the browser DOM). 1 ReDoS hint on the email pattern: worst-case input of 254 characters takes microseconds (timed). No change needed.
- **ZAP, website dev server:** the passive scan ran on the development server, which does not send the `_headers` file. The findings there are the SL-008 gap. ZAP checks headers, not `<meta>`, so it cannot confirm the fix; `csp.spec.ts` does.
- **ZAP, "Timestamp Disclosure" on `/api/v1/me`:** the signed-in person's own `created_at`. Expected.

## Second pass (bypass attempts after the fixes)

- Look-alike names with mixed separators and digits (`a-d-m1n`, `4dm-1n`): refused.
- Direction override hidden inside a WhatsApp message and a link title, not only the display name: refused.
- Username race with 50 requests, then again with a first claim mixed in: 1 winner in both.
- Style hash: a page with an attacker's `</style><script>` payload in the bio still has exactly one style block, and the script is escaped.
- Website policy: injected inline script, event handler and remote script all blocked on all 6 pages.
- Encoding tricks on addresses (percent-encoding, HTML entities, full-width letters, Cyrillic `а`) and on ids (`%00`, trailing slash, upper case): refused.

## Stage 7 addendum: the new surface

Stage 7 added a service worker, device storage for offline drafts, a Brevo email sender and a one-Worker deploy setup. They were checked as follows. This is a **smaller, lighter pass than Stage 6**, not a repeat of it.

| Area | Attack tried | Result |
|---|---|---|
| Service worker | Call `/api/v1/me` and `/u/ada` through the page, then list everything the worker saved | Nothing under `/api/` or `/u/` is saved (browser test) |
| Device storage | Plant drafts for another account | Ignored (browser test, unit test) |
| Device storage | Plant a snapshot with an unknown theme, font or link kind, wrong types, or a draft with an `admin` username, an `javascript:` address, a hidden direction character or a backwards schedule | All dropped, the dashboard keeps working (unit tests). **Found while building:** an unknown font value crashed the whole dashboard on every start. Now every read is validated |
| Device storage | A save that is still in flight after sign-out writes the data back | **Found and fixed (SL-015, Medium for a shared computer):** drafts reappeared after sign-out. Writes are now blocked after sign-out. Regression: browser test "signing out removes the copy and the drafts" |
| Brevo sender | Put markup in the link; make Brevo refuse and read the log | HTML escaped. The log holds the status number only (unit tests) |
| Public error page | Make the database fail on `/u/ada` and read the page | Friendly page, no SQL or table names, strict policy, not cached (API test) |
| Deploy setup | Probe `/api`, `/u`, `/dashboard`, a missing page and the headers on a local copy of the runtime | Routing and headers as intended |

Not attacked: the live Cloudflare edge, real Brevo, real phones. See `docs/NOT_TESTED.md`.

## Not tested (read this)

- **OSV-Scanner could not run.** The sandbox blocks `api.osv.dev` ("Forbidden"). `pnpm audit` (npm advisory database) was used instead. Run `osv-scanner scan source -L pnpm-lock.yaml` on a normal connection before release.
- **Real services:** Cloudflare Turnstile, Google and GitHub sign-in, and the email provider were not called. Their failure modes are tested with fakes.
- **The live Cloudflare edge:** the `cf-connecting-ip` header is trusted because Cloudflare sets it; that was not verified on a deployed site. Per-isolate memory limits (SL-007) can only be judged there. The website's `_headers` are checked as file content, not as live responses.
- **Browsers:** only Chromium was used for policy tests. Safari and Firefox were not.
- **Scale:** no large denial-of-service test, and no test of Cloudflare's free-tier limits under load.
- **Humans:** social engineering, phishing pages created by owners (there is a report button but no moderation screen, B-031), abuse handling, and legal review (B-030).
- **The active ZAP scan** covered the API only, for 6 minutes, with one signed-in user.
- **Independent review:** none. **An independent human security review is recommended before launch with real users.**

## Release gate (section 9)

| Gate | Status |
|---|---|
| 0 open Critical or High | Met. No Critical or High was found in the app. The 5 High advisories in dev tooling (SL-011) are fixed |
| 0 open Medium without owner sign-off | Met. SL-003, SL-004, SL-005, SL-008 and SL-011 are fixed and re-attacked. No Medium is open |
| All regression tests green | Met: shared 170, web 29, API 316 unit and integration tests; 82 browser tests (including 7 policy tests); lint, type check and build clean |
| Scanners clean or exceptions documented | Met with documented exceptions (OSV-Scanner blocked; Semgrep notes explained) |
| Headers verified | Worker: verified. Website `_headers`: verified on a local copy of the runtime (applied to files served as assets); the live check is Stage 8 |
| Secrets scan clean | Met |
| SECURITY.md with a private way to report | Written. The owner must switch on private vulnerability reporting and set the email address |
