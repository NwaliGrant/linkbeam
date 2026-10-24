import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

export default defineConfig({
  integrations: [preact()],
  devToolbar: { enabled: false },
  // "file" makes /dashboard a file (dashboard.html), so Cloudflare serves it directly instead of redirecting to /dashboard/.
  build: { inlineStylesheets: "auto", format: "file" },
  // Red team row 4/12: every page carries a content security policy. Astro adds the hashes of its own inline
  // scripts and styles, so an injected script cannot run. Cloudflare Turnstile is the only outside script allowed.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src https://challenges.cloudflare.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: { resources: ["'self'", "https://challenges.cloudflare.com"] },
      // Inline style attributes (set by the dashboard) are allowed; inline style elements still need Astro's hashes.
      styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }] },
    },
  },
  // In development the site and API run on different ports. This makes /api look like it is on the
  // same host as the site, which is how it works in production, so the session cookie behaves the same.
  vite: { server: { proxy: { "/api": "http://127.0.0.1:8787", "^/u/.*": "http://127.0.0.1:8787" } } },
});
