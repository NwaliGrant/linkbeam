# Free-tier limits

Checked on **2026-10-15** by web search of vendor documentation. Limits change, so check again at release. Where a number came from a third-party page instead of the vendor, it says so.

Rule for this project: no service may need a credit card. If one asks for a card, stop and pick another.

## Summary

| Service | Used for | Free limit that matters | Card needed? |
|---|---|---|---|
| Cloudflare Workers | API | 100,000 requests/day, 1,000/min burst, 10 ms CPU per request, 50 subrequests per request | No |
| Cloudflare D1 | Database | 5 GB total, 5 million rows read/day, 100,000 rows written/day | No |
| Cloudflare Pages | Web hosting | 500 builds/month, 20,000 files per site, 25 MiB per file, 100 custom domains per project | No |
| Cloudflare R2 | Not used (see D-003) | 10 GB, 1M writes, 10M reads per month | Disputed, see below |
| Cloudflare Turnstile | Bot protection | Unlimited challenges, 20 widgets, 10 hostnames per widget | No |
| Brevo | Magic-link email | 300 emails/day | No (third-party sources) |
| Resend | Email fallback | 3,000 emails/month and 100/day, 1 domain | Not stated |
| GitHub Actions | CI | Free on standard runners for public repositories | No |

## What happens when the limit is hit

| Limit | What happens | What Linkbeam does |
|---|---|---|
| Workers 100,000 requests/day | Requests fail until 00:00 UTC. Static assets are free and unlimited, so public pages still load. | **Changed in Stage 4:** public pages are made by the Worker (D-041), so they also stop when the limit is reached. Click tracking is fire-and-forget, so links still open on a page that is already showing. See the note below. |
| Workers 10 ms CPU | The request errors. | Keep handlers small. No image processing in the Worker beyond a size-capped re-encode. Check this in Stage 3. |
| D1 100,000 rows written/day | Queries fail until 00:00 UTC. Each indexed write counts extra. | Aggregate click counts per day, not per click. Show a friendly "try again later" message. |
| D1 5 million rows read/day | Same. | Use indexes. Cache public page data. |
| D1 5 GB storage | Writes fail. | Avatars are small. Delete expired tokens and sessions. |
| Pages 500 builds/month | Deploys stop until next month. | CI builds on pull requests do not deploy. Deploy only on tags and main. |
| Brevo 300 emails/day | Sending stops for the day. | Rate-limit magic links per email and per IP. Show a "try again later" message. |
| Resend 100 emails/day | Sending pauses (no overage billing on free). | Fallback only. |
| Turnstile | No disruption reported at the limits. | None needed. |

## Stage 2 effect on the free limits
- **D1 writes.** Each magic-link request now writes up to 3 rows (rate counter x2, token). A sign-in writes a session, an audit row and sometimes a user and a counter. A busy day of 1,000 sign-ins is about 6,000 writes, well inside 100,000.
- **/track is limited in memory, not D1**, because a D1 write per click would use the daily budget (D-025).
- **Cron Triggers.** One daily job uses 1 of 5 free triggers.
- **Subrequests.** Sign-in with Google makes 1 call, GitHub makes 2, Turnstile makes 1. The limit is 50 per request.

Cloudflare says upgrading to a paid plan lifts the Workers and D1 limits. Nothing upgrades automatically, so there is no surprise bill on the free plans.

## Notes and disagreements between sources

- **Workers and Pages Functions share one daily request count.** Static asset requests do not count.
- **Turnstile widget limit.** Cloudflare's plans page says 20 widgets. An older widget page says 10. The plans page is newer, so I used 20. Linkbeam needs two (sign-in and report).
- **D1 rows read.** The Cloudflare pricing page says 5 million/day for D1. A different number (50 million) on the same plans page belongs to Durable Objects SQL, not D1.
- **R2 and credit cards.** The vendor's own R2 pricing text lists the free tier but does not say whether a card is needed. A freetier.co listing and a Reddit thread say a card is required. A dev.to guide says it is not. I could not verify this myself, so Linkbeam does not use R2 for now.
- **Brevo card.** "No credit card required for the free plan" comes from a third-party demo page, not Brevo's own pricing page. Verify at sign-up.
- **Resend card.** None of the sources I found state whether a card is needed.

## Sources

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare plans summary: https://www.cloudflare.com/plans.md
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
- Resend limits: https://resend.com/docs/knowledge-base/account-quotas-and-limits
- Brevo free plan (third-party): https://dreamlit.ai/blog/brevo-review
- GitHub Actions and public repositories: https://docs.github.com/en/get-started/learning-about-github/githubs-products

## Stage 4: what a public page costs
- **Workers requests.** A visit is 2 requests (the page and the view count). Each link tap is 1 more. With 100,000 requests a day, expect about 50,000 views a day, fewer if many visitors tap links. After that, pages and the dashboard stop until 00:00 UTC.
- **D1 reads.** A page view runs 2 small reads (the person, then their links), so 5 million reads a day is not the limit that matters.
- **D1 writes.** Each view or tap writes 1 counter row (grouped per day), so about 100,000 views and taps a day in total. This is the second limit to watch, and it is close to the Workers limit.
- **What to do about it:** see D-041 and B-027 for options. Nothing has been deployed, so no limit is being hit today.

