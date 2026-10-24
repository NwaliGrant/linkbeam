# Contributing to Linkbeam

Thank you for helping. Linkbeam is a free, open-source link-in-bio tool for creators, freelancers and small businesses, built with Nigerian users first and open to everyone. Small fixes, translations, design improvements, tests and docs are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Your contributions are licensed under the project's [MIT licence](LICENSE).

## Our four design principles

Every change is judged against these. If a change breaks one, it needs a very good reason.

1. **Fast.** The public page must stay under about 100 KB with almost no JavaScript, and score 95 or more in Lighthouse on a throttled phone. Many visitors use slow, cheap phones.
2. **Free.** Nothing may need a credit card or a paid plan. No payment features: Linkbeam links out to other people's pages and never handles money.
3. **Accessible.** Touch targets at least 44 by 44 pixels, body text at least 16 px, works from 320 px wide, WCAG AA contrast, a dark mode, and everything reachable by keyboard.
4. **Private.** Collect as little as possible. No third-party trackers, no ads, no tracking scripts, fonts served by us.

## Set up

You need Node 20 or newer, Git and pnpm. The full steps (including Windows PowerShell) are in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#part-1-run-it-on-your-computer). In short:

```bash
pnpm install
pnpm check          # types, lint, unit tests and build
```

## Branch, change, test

1. Fork the repository and create a branch with a short name, for example `fix-link-reorder` or `add-yoruba-translation`.
2. Make small, focused commits. Write the message in the imperative mood: **"Add link reorder endpoint"**, not "Added" or "Adding".
3. **Write the test first** for a bug: make a test that fails, then fix the code until it passes. Never delete or weaken a test to make it pass. Never switch off a security control to make a test pass.
4. Run the checks that match your change:

| Change | Run |
|---|---|
| Anything | `pnpm check` |
| Anything the browser shows | `pnpm e2e` (needs Chromium, see the README) |
| Public page or landing page speed | `pnpm lighthouse` |
| New dependency | `node scripts/licenses.mjs` (the licence must work with MIT) |
| Security-sensitive code | The security scans below |

5. Open a pull request. Fill in the template: what changed, which tests you ran, and any security notes.

## Security scans

Run these on your own computer only, never on someone else's site.

```bash
pnpm audit --audit-level=high                       # known weak dependencies
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:latest detect --source /repo --redact   # secrets in history
```

The attack tests (`apps/api/test/redteam-*.test.ts`) run with `pnpm test`. If you add a feature that takes user input, add a test that tries to abuse it. [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) explains what we defend against.

**Found a vulnerability? Do not open a public issue.** Follow [SECURITY.md](SECURITY.md).

## Rules for code

- TypeScript in strict mode. No `any`, no `!` non-null assertions (lint will stop you).
- Validate every input with a Zod schema in `packages/shared`. The browser and the API share the same rules.
- Words that visitors or link editors read go in `packages/shared/src/i18n/en.ts`, not inside code. See [docs/TRANSLATING.md](docs/TRANSLATING.md).
- Write plain, simple English in docs and messages. Short sentences. Explain a word the first time it appears.
- Put a reversible choice in [docs/DECISIONS.md](docs/DECISIONS.md) and a known gap in [docs/BACKLOG.md](docs/BACKLOG.md). Do not hide either in a code comment.
- Never commit secrets, `.env` files or database backups. The CI secret scan will fail the pull request.
- Fonts, icons and pictures must be your own work or under an open licence (OFL, ISC, CC0, MIT). Record the source in `docs/THIRD_PARTY_LICENSES.md`.

## Good first issues

Look for the `good first issue` label. Ideas that are always welcome:

- **Translate** the visitor-facing words into French, Yoruba, Hausa, Igbo or Swahili (copy `en.ts`, see [docs/TRANSLATING.md](docs/TRANSLATING.md)). Native speakers are the best reviewers.
- **Move dashboard text** into the translation file (B-032).
- **Add a component test** for a Preact component (B-024).
- **Improve a hint or error message** so it is shorter and clearer.
- **Check on a real phone**: pick an item in [docs/NOT_TESTED.md](docs/NOT_TESTED.md), try it, and report what you saw.
- **Accessibility**: use the site with a screen reader (NVDA is free on Windows) and tell us what is confusing.

## Reviews

A maintainer reads every pull request. We try to answer within a week. We may ask for changes, and we will explain why. Disagreement is fine; please keep it kind and about the code.
