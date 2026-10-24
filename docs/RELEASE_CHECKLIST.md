# Release checklist

What is done, what only you can do, and the order. Tick as you go. See also [NOT_TESTED.md](NOT_TESTED.md).

## Already done (Stages 0 to 8)

- [x] All Stage 0 to 7 work built, reviewed and tested; fresh-clone `pnpm check` passes
- [x] Release gate from the security review met ([SECURITY_REPORT.md](SECURITY_REPORT.md)): 0 open Critical or High, 0 open Medium, regression tests green, secrets scan clean
- [x] Dependency licences checked (`node scripts/licenses.mjs`)
- [x] Smoke test script written and run against a local copy of the deploy setup (`scripts/smoke.mjs`)
- [x] Release workflow written (`.github/workflows/release.yml`), **not yet run on GitHub**
- [x] CHANGELOG written; release candidate tag `v1.0.0-rc.1` made locally

## Only you can do these (in this order)

1. **Create the GitHub repository** (public, MIT) and push: `git remote add origin https://github.com/YOUR-NAME/linkbeam.git`, then `git push -u origin main --tags`. Replace `YOUR-NAME` in the README, `SELF_HOSTING.md` and `.github/ISSUE_TEMPLATE/config.yml`.
2. **Switch on** private vulnerability reporting (repository Settings, Security) and replace `security@YOUR-DOMAIN` in `SECURITY.md` and `conduct@YOUR-DOMAIN` in `CODE_OF_CONDUCT.md` (B-037).
3. **Create the accounts** (all free, no card): Cloudflare, Brevo (verify a sender address) and a Cloudflare Turnstile widget. Follow [SELF_HOSTING.md](SELF_HOSTING.md) steps 1 to 6.
4. **Run OSV-Scanner** on a normal connection: `osv-scanner scan source -L pnpm-lock.yaml` (B-036).
5. **Deploy by hand once** (SELF_HOSTING steps 7 to 8), then run the smoke test: `node scripts/smoke.mjs https://YOUR-ADDRESS`. Fix anything that fails.
6. **Work through NOT_TESTED.md** at least sections A (real phone), B (real inbox) and C (live Cloudflare). Sign in with a real email and open your page on a real phone.
7. **Get the Terms and Privacy pages reviewed** (B-030) and decide who reads reports and how often (B-031).
8. **Plan an independent security review** before you promote the site to many people.
9. **Tag the release**: `git tag -a v1.0.0 -m "Linkbeam 1.0.0"` and `git push origin v1.0.0`. Only do this when steps 5 and 6 pass.
10. *(Optional)* For automatic deploys, add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the variables `SITE_URL`, `PUBLIC_TURNSTILE_SITE_KEY` and `PUBLIC_CONTACT_EMAIL`, and a protected `production` environment. Then pushing a `v*` tag runs the whole release. Create the token in the Cloudflare dashboard with only the permissions Workers and D1 need.

## Decide before you announce

- [ ] The free request budget (B-027): public pages use about 2 requests per view, and the free limit is 100,000 a day. Choose to accept it, add a Cloudflare Cache Rule on a custom domain, or move later.
- [ ] Heavy-traffic protection (B-035).
- [ ] Which languages to add first ([TRANSLATING.md](TRANSLATING.md)).
