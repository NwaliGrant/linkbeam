# Self-hosting Linkbeam

You can run Linkbeam on **your own computer** (to try it or to work on it) or on **your own free Cloudflare account** (for real use). Nothing here needs a credit card.

> **Honest status.** The deploy steps below were checked as far as they can be without your accounts: the deploy settings were run on a local copy of Cloudflare's runtime (the website, the API, the 404 page and the security headers all answered correctly from one address), and `wrangler deploy --dry-run` accepts the settings. They have **not** been run against a real Cloudflare, Brevo or Turnstile account. See [NOT_TESTED.md](NOT_TESTED.md). If a step differs from what you see on screen, trust the screen and please open an issue.

---

## Part 1. Run it on your computer

You need Node 20 or newer (22 recommended), Git and pnpm.

**Windows (PowerShell):**

```powershell
git clone https://github.com/NwaliGrant/linkbeam.git
cd linkbeam
.\scripts\setup.ps1
```

**macOS or Linux:**

```bash
git clone https://github.com/NwaliGrant/linkbeam.git
cd linkbeam
pnpm install && pnpm check
```

Then create the settings file and the local database, and start both apps in two terminals.

```powershell
# PowerShell
Copy-Item .env.example apps\api\.dev.vars
cd apps\api
pnpm exec wrangler d1 migrations apply linkbeam --local     # once
pnpm dev:api      # terminal 1, from the repository root:  pnpm dev:api
pnpm dev:web      # terminal 2, from the repository root:  pnpm dev:web
```

```bash
# macOS or Linux
cp .env.example apps/api/.dev.vars
(cd apps/api && pnpm exec wrangler d1 migrations apply linkbeam --local)   # once
pnpm dev:api    # terminal 1
pnpm dev:web    # terminal 2
```

Open http://localhost:4321. With `MAIL_MODE=console` in `.dev.vars`, the sign-in link is **printed in the API terminal** instead of emailed. Click it (or paste it into the browser).

Local data lives in `apps/api/.wrangler/`. Delete that folder to start again from nothing.

---

## Part 2. Put it on the internet for free (Cloudflare)

Linkbeam runs as **one Cloudflare Worker** that serves both the website files and the API, so they share one address (for example `https://linkbeam.NwaliGrant.workers.dev`). That is required: the site and the API must be on the same host (see D-013 and D-062 in [DECISIONS.md](DECISIONS.md)).

What you need (all free, no card):

| Service | What it does | Where |
|---|---|---|
| Cloudflare account | Runs the Worker, the database and the bot check | https://dash.cloudflare.com/sign-up |
| Brevo account | Sends the sign-in emails (300 a day free) | https://www.brevo.com |
| A GitHub copy of this code | So you can change and update it | your own fork |

Check the current free limits in [FREE_TIER_LIMITS.md](FREE_TIER_LIMITS.md). **Read the note about public-page traffic (B-027)**: the free Workers plan allows 100,000 requests a day, and every page view uses about two.

### Step 1. Log in to Cloudflare from your computer

```powershell
cd apps\api
pnpm exec wrangler login
```

A browser window opens. Approve it. (On macOS and Linux the commands are the same, with `/` instead of `\`.)

### Step 2. Choose your address

In the Cloudflare dashboard open **Workers & Pages** and, if asked, choose your **workers.dev subdomain** (for example `NwaliGrant`). Your site will then be:

```
https://linkbeam.NwaliGrant.workers.dev
```

Write it down. It is your `APP_URL`. If you would rather not choose first, deploy once (Step 8) and Wrangler will ask you to choose; then change `APP_URL` and deploy again.

### Step 3. Create the database

```powershell
pnpm exec wrangler d1 create linkbeam
```

It prints a `database_id`. Open `apps/api/wrangler.deploy.toml` and replace `PASTE-YOUR-DATABASE-ID-HERE` with it. In the same file replace `APP_URL` with your address from Step 2 (with `https://` and **no slash at the end**).

Create the tables:

```powershell
pnpm exec wrangler d1 migrations apply linkbeam --remote -c wrangler.deploy.toml
```

### Step 4. Set up the bot check (Cloudflare Turnstile)

In the dashboard open **Turnstile**, choose **Add widget**, give it any name, add your site's host name (for example `linkbeam.NwaliGrant.workers.dev`, no `https://`), and pick **Managed**. You get two keys:

- the **site key** (public). Put it in `apps/web/.env`, like this (the file is ignored by Git):

  ```
  PUBLIC_TURNSTILE_SITE_KEY=your-site-key
  ```

- the **secret key** (private). It goes in as a secret in Step 6. **Never paste it into a chat or a file you commit.**

Without Turnstile, sign-ups are refused on purpose. A missing key blocks people; it does not switch the protection off.

### Step 5. Set up sign-in email (Brevo)

1. Create a free Brevo account.
2. In Brevo, verify the **sender address** you want emails to come from (Brevo guides you; a Gmail address works for a small site, but a domain you own gives better delivery).
3. In Brevo open **SMTP & API → API keys** and create a key. Keep it private.
4. In `apps/api/wrangler.deploy.toml` set `BREVO_SENDER_EMAIL` under `[vars]` to that verified address. Add this line if it is not there:

   ```toml
   BREVO_SENDER_EMAIL = "you@your-domain.example"
   ```

`MAIL_MODE` stays `"brevo"`. **Never use `console` on a live site**: it prints sign-in links into the logs.

### Step 6. Add the secrets

Secrets are stored by Cloudflare, not in your files. Each command asks you to type or paste the value.

```powershell
pnpm exec wrangler secret put IP_HASH_SECRET -c wrangler.deploy.toml      # any long random text
pnpm exec wrangler secret put TURNSTILE_SECRET -c wrangler.deploy.toml    # from Step 4
pnpm exec wrangler secret put BREVO_API_KEY -c wrangler.deploy.toml       # from Step 5
```

If Wrangler says the Worker does not exist yet, run Step 8 first, then come back and run these, then deploy once more.

Optional Google and GitHub sign-in: create the apps yourself, register the redirect addresses `https://YOUR-ADDRESS/api/v1/auth/google/callback` and `https://YOUR-ADDRESS/api/v1/auth/github/callback`, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` with `wrangler secret put`. Without them those buttons simply do not sign anyone in.

### Step 7. Optional site settings

Put these in `apps/web/.env` (not secret, they are shown on the website):

```
PUBLIC_SITE_URL=https://linkbeam.NwaliGrant.workers.dev
PUBLIC_REPO_URL=https://github.com/NwaliGrant/linkbeam
PUBLIC_CONTACT_EMAIL=you@your-domain.example
```

Then **read and edit the Terms and Privacy pages** (`apps/web/src/pages/terms.astro` and `privacy.astro`). They are plain-English **templates, not legal advice**. Have them checked for the countries where you will operate.

### Step 8. Build and deploy

```powershell
# from the repository root
pnpm install
pnpm build
cd apps\api
pnpm exec wrangler deploy -c wrangler.deploy.toml
```

Wrangler prints your address. Open it.

### Step 9. Check that it works

1. Open your address. The landing page should load.
2. Choose **Sign in**, enter your email, and finish the bot check. An email should arrive within a minute (look in spam too).
3. Click the link. You should land in the dashboard. Choose a username in Settings and add one link.
4. Open `https://YOUR-ADDRESS/u/your-username` in a private window. Your page should show.
5. Do not run the project's security or load tests against a site that is not yours. They are for your own computer and your own staging site only.

### Updating later

```powershell
git pull
pnpm install
pnpm build
cd apps\api
pnpm exec wrangler d1 migrations apply linkbeam --remote -c wrangler.deploy.toml   # only changes what is new
pnpm exec wrangler deploy -c wrangler.deploy.toml
```

Read [CHANGELOG.md](../CHANGELOG.md) first. Each migration is tested for upgrading from the one before it.

---

## Part 3. Backups and restore

Your whole site is one D1 database. **Make a backup before every update and on a regular schedule.**

**Back up:**

```powershell
cd apps\api
pnpm exec wrangler d1 export linkbeam --remote --output ..\..\backup-2026-10-23.sql -c wrangler.deploy.toml
```

The file contains **everyone's data** (emails, pages, photos). Keep it private, never commit it to Git (`backup-*.sql` is ignored), and delete old copies.

**Restore** into a **new, empty** database (this is the safe way):

```powershell
pnpm exec wrangler d1 create linkbeam-restored
# put the new database_id in apps\api\wrangler.deploy.toml, then:
pnpm exec wrangler d1 execute linkbeam-restored --remote --file ..\..\backup-2026-10-23.sql -c wrangler.deploy.toml
pnpm exec wrangler deploy -c wrangler.deploy.toml
```

Cloudflare D1 also keeps a recent history you can roll back to (called Time Travel). The length of that history on the free plan can change; check Cloudflare's current documentation.

> The export and restore commands are Cloudflare's own documented commands, but they have **not** been run against a real database for this project (see [NOT_TESTED.md](NOT_TESTED.md)). Do a practice restore into a throwaway database before you rely on it.

A person can also download their own data (and delete their account) in **Settings**. That does not replace your backup.

---

## Part 4. Running the site responsibly

**Reports.** People can report a page. Reports are not shown in a screen yet (B-031), so read them in the database:

```powershell
pnpm exec wrangler d1 execute linkbeam --remote -c wrangler.deploy.toml --command "SELECT r.created_at, u.username, r.reason, r.status FROM reports r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 20"
```

`created_at` is a Unix time (seconds). Check reports regularly. The Terms promise that a person reads each one.

**Hiding a page.** Banning an account hides its public page and stops it signing in:

```powershell
pnpm exec wrangler d1 execute linkbeam --remote -c wrangler.deploy.toml --command "UPDATE users SET is_banned = 1 WHERE username = 'the-username'"
pnpm exec wrangler d1 execute linkbeam --remote -c wrangler.deploy.toml --command "UPDATE reports SET status = 'actioned' WHERE user_id = (SELECT id FROM users WHERE username = 'the-username')"
```

To undo it, set `is_banned` back to `0`. Be careful with the username in quotes: a wrong name changes nothing, a wrong command can change much. Back up first.

**Cleaning up.** A daily job removes expired sign-in links, old sessions, rate-limit rows, and security-log lines older than 90 days. You do not need to run it.

**Security.** Before real people use your site, read [SECURITY_REPORT.md](SECURITY_REPORT.md) (especially "Not tested"), switch on private vulnerability reporting for your repository, set a real security address in [SECURITY.md](../SECURITY.md), and consider an independent security review.

## Settings reference

| Name | Where | Secret? | What it does |
|---|---|---|---|
| `APP_URL` | `wrangler.deploy.toml` `[vars]` | No | Your site's address. Sign-in links and the cross-site check use it. |
| `MAIL_MODE` | `[vars]` | No | `brevo` for real email. `console` only on your own computer. |
| `BREVO_SENDER_EMAIL` | `[vars]` | No | The verified address emails come from. |
| `BREVO_API_KEY` | `wrangler secret put` | **Yes** | Lets the Worker send email through Brevo. |
| `TURNSTILE_SECRET` | `wrangler secret put` | **Yes** | Checks bot-check answers. |
| `IP_HASH_SECRET` | `wrangler secret put` | **Yes** | Hashes visitor addresses in the security log. Without it no address hash is stored. |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `GITHUB_CLIENT_ID` / `_SECRET` | `wrangler secret put` | **Yes** | Optional social sign-in. |
| `PUBLIC_TURNSTILE_SITE_KEY` | `apps/web/.env` before `pnpm build` | No | Shows the bot check on sign-in and report pages. |
| `PUBLIC_SITE_URL`, `PUBLIC_REPO_URL`, `PUBLIC_CONTACT_EMAIL` | `apps/web/.env` before `pnpm build` | No | Shown in page links, social cards and the legal pages. |
