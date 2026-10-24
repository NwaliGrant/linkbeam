# Stage 6 scanner summaries (all run against localhost or the source tree only)

## sqlmap 1.x, level 3 (level 2 for /track), risk 1, techniques B/E/U/S/T
- GET /api/v1/u/scanme*: NOT INJECTABLE
- GET /u/scanme*: NOT INJECTABLE
- GET /api/v1/avatar/abc123* (baseline 404, sqlmap could not test; covered by redteam-injection.test.ts): could not test (404)
- GET /api/v1/me/stats?days=7 (signed in): NOT INJECTABLE
- POST /api/v1/track JSON page: NOT INJECTABLE
- PATCH /api/v1/me JSON display_name, bio (signed in): NOT INJECTABLE
- POST /api/v1/links JSON title (signed in): NOT INJECTABLE

## OWASP ZAP 2.16.1
- passive baseline (spider + passive rules), API and website dev server:
  - http://localhost:4321: Medium (High) | Content Security Policy (CSP) Header Not Set | instances 9
  - http://localhost:4321: Medium (Medium) | Missing Anti-clickjacking Header | instances 8
  - http://localhost:4321: Low (Medium) | X-Content-Type-Options Header Missing | instances 16
  - http://localhost:4321: Informational (Low) | Information Disclosure - Suspicious Comments | instances 2
  - http://localhost:4321: Informational (Medium) | Modern Web Application | instances 2
  - http://127.0.0.1:8787: Medium (High) | CSP: style-src unsafe-inline | instances 3
- active scan, 6 minutes, API only:
  - http://127.0.0.1:8787: Medium (High) | CSP: style-src unsafe-inline | instances 1
  - http://127.0.0.1:8787: Low (Low) | Timestamp Disclosure - Unix | instances 1
  - http://127.0.0.1:8787: Informational (Medium) | User Agent Fuzzer | instances 72

## Semgrep (community rules: javascript, typescript, generic/secrets, html), 427 rules, 93 files
- 168 findings, 0 scan errors
  - jsx-not-internationalized: 118
  - html-in-template-string: 30
  - i18next-key-format: 7
  - missing-template-string-indicator: 7
  - robots-denied: 3
  - prohibit-jquery-html: 2
  - detect-redos: 1

## ZAP active scan again after the fixes (3 minutes, API)
- Low (Low) | Timestamp Disclosure - Unix | the signed-in person's own created_at
- Informational (Medium) | User Agent Fuzzer | 72
- The earlier "CSP: style-src unsafe-inline" alert is gone.

## gitleaks 8.28
- All 21 commits: no leaks (one false alarm allow-listed in .gitleaks.toml). All tracked files: no leaks. Built website and Worker bundle: no leaks.

## pnpm audit
- Before: 17 findings (5 high), all in Miniflare's own copies of undici and sharp (dev only). After pinning patched versions: No known vulnerabilities found.

## OSV-Scanner
- Could not run: api.osv.dev returned Forbidden from this sandbox (B-036).
