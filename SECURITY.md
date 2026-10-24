# Security policy

Linkbeam is free and open source. Thank you for helping keep it safe.

## Report a problem privately

Please do **not** open a public issue for a security problem.

1. Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. (The owner must switch on "Private vulnerability reporting" in the repository settings. This is listed in the release checklist.)
2. If you cannot use GitHub, email **nwaligrant@gmail.com** (placeholder: the owner replaces this with a real address before release).

Please include: what you found, the steps to repeat it, and what you think the impact is. A short script or a few `curl` lines is ideal.

## What to expect

- We will reply within 7 days to say we got your report.
- We will tell you when it is fixed, and credit you if you wish.
- Please give us a reasonable time (90 days at most) to fix a problem before you share it publicly.

## Rules for testing

- Test only your **own** copy of Linkbeam (on your computer) or your own staging site. Do not attack the live site, other people's accounts or other people's data.
- Do not run denial-of-service tests against the live site.
- Do not look at, change or keep other people's data. If you reach some by accident, stop and tell us.

## What is in scope

The code in this repository, and a site you deploy from it. Problems in Cloudflare, Brevo or other services we use should be reported to them.

## Supported versions

Only the latest release gets security fixes while the project is young.

## What we have already tested

See [docs/SECURITY_REPORT.md](docs/SECURITY_REPORT.md) for what was attacked, what was found, and what was **not** tested. The threat model is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). An independent human review is recommended before a launch with real users.
