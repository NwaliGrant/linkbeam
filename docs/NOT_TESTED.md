# What has NOT been tested

Linkbeam's tests run on a developer machine and in CI: unit and integration tests, a real Chromium browser, accessibility checks (axe), Lighthouse and security scans. They cannot stand in for real phones, real inboxes and a real Cloudflare account. This file lists what still needs **a human to check by hand**, with simple steps.

Tick each one, write the date and what you saw. If something fails, open an issue (never put keys or sign-in links in it).

Last updated: 2026-10-24 (Stage 8).

## A. On a real phone

| # | What to check | How | Done |
|---|---|---|---|
| A1 | **Install the app** | Android Chrome: open your site, menu, **Install app**. iPhone Safari: **Share**, **Add to Home Screen**. The Linkbeam icon should look sharp. On Android the icon should not be cut badly in a circle. | [ ] |
| A2 | **Offline editing** | Open the installed app once online. Switch on aeroplane mode. Open it again: the dashboard should load with a "You are offline" notice. Change a link title. Switch aeroplane mode off: the change should send, and the notice should go. | [ ] |
| A3 | **iPhone storage** | Safari can delete a site's stored data after about 7 days without use. Make an offline edit, do not open the site for a week, and see whether the draft survives. If it does not, that is a Safari rule, not a bug, but you should know. | [ ] |
| A4 | **Touch reordering** | Drag a link by its handle with your finger, and also use the up and down buttons. | [ ] |
| A5 | **WhatsApp, call, email and map buttons** | On the public page, tap each. WhatsApp should open a chat (the app if installed). Call should open the dialler. Email should open a mail app. Map should open the map. | [ ] |
| A6 | **QR code** | Download the QR PNG in Share, and scan it with a phone camera from a screen and from paper. | [ ] |
| A7 | **Slow network** | Use the phone on a weak 3G or 2G connection, or turn on "Slow 3G" in browser tools. The public page should still show quickly. (Lighthouse only simulates this.) | [ ] |
| A8 | **Dark mode** | Switch the phone between light and dark. The dashboard and the public page should stay readable. | [ ] |
| A9 | **Screen reader** | TalkBack (Android) or VoiceOver (iPhone): sign in, add a link, delete it and undo it. Tell us what is confusing. (We only ran automatic checks.) | [ ] |

## B. In a real inbox and with real accounts

| # | What to check | How | Done |
|---|---|---|---|
| B1 | **Brevo sign-in email** | On your live site, request a sign-in link. It should arrive in under a minute, from your verified sender, not in spam. The link should work once, and fail the second time. Check your Brevo account still shows no card needed and what it says about sender checks. | [ ] |
| B2 | **Expired link** | Wait 16 minutes, then use an old link. It should say the link is not valid. | [ ] |
| B3 | **Turnstile** | On the live sign-in page the bot check should appear and pass. Try from a phone and a laptop. (Tests used Cloudflare's dummy keys, never the real widget.) | [ ] |
| B4 | **Google and GitHub sign-in** | Create your own apps, register the redirect addresses in `docs/SELF_HOSTING.md`, and sign in with each. (Tests stubbed the network.) | [ ] |

## C. On the live Cloudflare site

| # | What to check | How | Done |
|---|---|---|---|
| C1 | **Security headers** | Run `curl -I https://YOUR-ADDRESS/` and `curl -I https://YOUR-ADDRESS/u/someone`. Look for `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy`. (A local copy of the runtime applied them; the real edge was not checked. B-038.) | [ ] |
| C2 | **Visitor address header** | The API trusts `cf-connecting-ip` for rate limits. Send 6 sign-in requests quickly from one network and check that the 6th is refused. | [ ] |
| C3 | **Page caching** | Open a public page twice and look for `cf-cache-status` in the headers. Edit the page and check the change appears within about a minute. | [ ] |
| C4 | **Request budget** | After a few days, look at the Workers dashboard. How many requests a day do you really use compared with the 100,000 limit? (B-027) | [ ] |
| C5 | **Backup and restore** | Run the export, then a practice restore into a throwaway database, as in `docs/SELF_HOSTING.md`. Check that a page still loads from the restored copy. | [ ] |
| C6 | **Updates** | Deploy a small change. Open the installed app: does it show the new version after one or two visits? (Service workers sometimes need a second visit.) | [ ] |
| C7 | **Cloudflare screens** | The deploy guide has words only. Compare it with what you see in the Cloudflare and Brevo dashboards, fix any step that differs, and add screenshots. | [ ] |

| C8 | **Smoke test on the live site** | Run `node scripts/smoke.mjs https://YOUR-ADDRESS` after deploying. All 15 checks should pass. (It passed 15 of 15 on a local copy only.) | [ ] |
| C9 | **Release workflow** | `.github/workflows/release.yml` was never run on GitHub. Push a test tag such as `v0.0.1-test` to a private copy first, with the secrets and the protected `production` environment set. | [ ] |

## D. Other browsers and settings

| # | What to check | How | Done |
|---|---|---|---|
| D1 | **Firefox and Safari** | All browser tests ran in Chromium only. Sign in, edit, reorder and view a public page in Firefox and Safari. | [ ] |
| D2 | **Private browsing** | Open the dashboard in a private window. It should work (drafts just cannot be kept). | [ ] |
| D3 | **Old phone** | Try on a low-cost Android phone more than 4 years old. | [ ] |

## E. People, law and security

| # | What to check | Who | Done |
|---|---|---|---|
| E1 | **Terms and Privacy** are templates, not legal advice. Have them reviewed for the countries you serve (for Nigeria, the Data Protection Act 2023). | A lawyer | [ ] |
| E2 | **Independent security review** before real users arrive. The red-team pass in `docs/SECURITY_REPORT.md` was done by the same project, with automatic scanners, and lists its own gaps. | An outside security professional | [ ] |
| E3 | **OSV-Scanner** could not reach its server from the build machine. Run `osv-scanner scan source -L pnpm-lock.yaml` on a normal connection (B-036). | You | [ ] |
| E4 | **Private vulnerability reporting** switched on, and real addresses put in place of `security@YOUR-DOMAIN` and `conduct@YOUR-DOMAIN` (B-037). | You | [ ] |
| E5 | **Moderation.** There is no screen for reports (B-031). Check that you can read them with the commands in `docs/SELF_HOSTING.md`, and decide who reads them and how often. | You | [ ] |
| E6 | **Heavy traffic and attacks** (load, denial of service, spreading fake view counts) were not tested (B-035). | You | [ ] |
| E7 | **Real-world abuse**: scams, impersonation, harmful pages. Tests cover the code, not people. | You | [ ] |
