# Backlog

Known gaps and follow-ups. Each one has a reason and a stage. Nothing here is hidden in code comments.

| ID | Item | Why it is not done | Planned |
|---|---|---|---|
| B-001 | ~~Resize avatars in the browser~~ done in Stage 3 (D-034). **Still open:** true server-side re-encoding | Worker CPU limit (D-012) | Stage 6 review |
| B-002 | ~~Idle session timeout~~ | **Done in Stage 2** (14 days idle, D-024) | Done |
| B-003 | Hard cap on `/track` abuse | Stage 2 added a best-effort per-instance limit (D-025). It slows a script but is not a guarantee, and nothing stops someone from spreading counts across many IPs. Needs sanity caps per page per day | Stage 6 (checklist 11) |
| B-004 | Reserve recently released usernames to stop impersonation | Needs a table of released names and a policy | Stage 6 |
| B-005 | ~~Scheduled cleanup~~ | **Done in Stage 2** (daily Cron Trigger, `cleanup.ts`) | Done |
| B-006 | Upgrade test for every future migration | Stage 2 added the 0001 to 0002 upgrade test. Each new migration needs its own | Every stage that adds a migration |
| B-007 | `PATCH /links/:id` can lose an edit if two requests race | Low impact, single owner. Could use a version column | Stage 6 review |
| B-008 | Check custom accent colour contrast on the server | The dashboard does the live check in Stage 3. The API only checks the format | Stage 3 |
| B-009 | ~~Rate limit and Turnstile on `/report`~~ | **Done in Stage 2** | Done |
| B-010 | Cache the public page at the edge and purge on change | Performance work for Stage 4 | Stage 4 |
| B-011 | ~~Sign-in page and Turnstile widget~~ | **Done in Stage 3** (D-039). The widget is untested against real Cloudflare (needs a site key) | Done |
| B-012 | ~~Old `audit_log` rows are never deleted~~ | Done in Stage 6: deleted after 90 days (`AUDIT_LOG_DAYS`) | Done |
| B-013 | Google and GitHub sign-in are untested against the real providers | Tests use the real Arctic code with a stubbed network. It needs the owner's OAuth apps and a deployed or tunnelled callback address | Stage 8 (owner action) |
| B-014 | OAuth sign-in does not link by provider account id | An account is matched by verified email only. If someone loses an email address to a new owner, the new owner could sign in. Same risk as magic links | Stage 6 review |
| B-015 | Magic-link quota can be used up by a stranger (SL-001) | Accepted trade-off of the per-address limit. Options: count only after a link is actually opened, or add a short cool-down message in the UI | Stage 6 review |
| B-016 | Login CSRF through a magic link (SL-002) | Show the signed-in email in the header with a one-click sign-out. Not done in Stage 7 (it is a design change, not polish) | After release |
| B-017 | ~~Share tab: copy link, QR (PNG and SVG), share buttons, bio tips~~ | Done in Stage 4 (D-045, D-046) | Closed |
| B-018 | ~~Installable dashboard that edits drafts offline~~ | Done in Stage 7 (D-064). Offline creating, deleting and reordering are B-041 | Done |
| B-019 | Landing page: live demo and username check | The landing page has a picture of a page, not a live demo, and no username check. Not done in Stage 7 | After release |
| B-020 | ~~Licence scan of all transitive dependencies~~ | Done in Stage 7 (`scripts/licenses.mjs`, D-066) | Done |
| B-021 | ~~Content-Security-Policy for the static site pages~~ | Done in Stage 6 (D-059) | Done |
| B-022 | Lighthouse for the dashboard | `pnpm lighthouse` covers the public page and static pages, and runs in CI. The dashboard needs a signed-in run. Not done | After release |
| B-023 | ~~The editor preview ignores link schedules (D-040)~~ | Done in Stage 4 with `isLiveAt` in the shared package (tested) | Closed |
| B-024 | No component-level tests for the Preact components | Behaviour is covered by 17 browser tests and 22 unit tests, but a bug in one component state would be found only by the browser run | Stage 7 |
| B-025 | Delete needs the link title in a confirmation for screen reader users beyond the toast | The toast is announced politely; consider focus move to Undo | Stage 7 |
| B-026 | A generated share image for each person | Today: the photo, or a default card (D-044). A generated card needs an image service or library that fits the free limits | Later |
| B-027 | Workers request budget for public pages (D-041) | Each page view is a Worker request plus a tracking request: about 50,000 views a day on the free plan. Decide on a Cache Rule, a custom domain, or pre-rendering | Stage 8 |
| B-028 | Count the page view on the server | Would halve the requests per view (D-041) but differs from the PDF's beacon design and counts bots | Stage 8 decision |
| B-029 | Automatic dark version of a public page | The page follows the owner's theme only (D-051) | Later |
| B-030 | Legal review of Terms and Privacy | They are plain-English starting texts (D-047) | Owner, before release |
| B-031 | Reports have no moderation screen | Reports are stored. `docs/SELF_HOSTING.md` shows how to read them and how to hide a page with SQL. A small admin view is still needed before real traffic | Owner decision |
| B-032 | Dashboard text is not yet in the translation file | Sign-in, setup, design, stats, settings and share tabs keep English text inside the components | Stage 7 |
| B-033 | Only English exists | Other languages (French, Yoruba, Hausa, Igbo, Swahili) can be added by copying `en.ts`, see `docs/TRANSLATING.md` | After release, by volunteers |
| B-034 | Optional "Buy me a coffee" accepts only Buy Me a Coffee | Other support pages (Ko-fi and similar) are not allowed on purpose (D-054). A short allow-list can grow later | Owner decision |
| B-035 | Stronger limit for /track and a daily sanity cap | The limit is in memory per Worker instance (SL-007). Use Cloudflare's free rate-limiting binding or a D1 counter | Before heavy traffic |
| B-036 | Run OSV-Scanner on a normal connection | It could not reach its server from the build sandbox | Owner, before release |
| B-037 | Turn on GitHub private vulnerability reporting and set the security email | `SECURITY.md` points to both | Owner, before release |
| B-038 | Check live response headers after deploy | Website headers come from Pages `_headers` and could only be checked as file content | Stage 8 smoke test |
| B-039 | Deploy from GitHub Actions on a tag | Stage 8 sets up the release. Deploying by hand with Wrangler is documented | Stage 8 |
| B-040 | Screenshots of the Cloudflare and Brevo dashboards in the deploy guide | They need real accounts and change often. The guide has words only | Owner, after the first real deploy |
| B-041 | Offline creating, deleting and reordering of links | Offline editing covers existing links, the profile and the design (D-064). The rest needs a safe way to give new links an id and settle conflicts | After release |
| B-042 | Tell the person when a new version of the app is ready | The service worker updates quietly, and the new version appears on the next visit | After release |
| B-043 | A wordmark (the name written out) for the logo | Only the mark exists. A wordmark needs a font converted to shapes | After release |
