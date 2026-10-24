/*
 * Linkbeam service worker. It does one job: let the dashboard open and work without a connection.
 *
 * What it touches: pages and files of this site, GET requests only.
 * What it never touches: /api/ (your data, always live), /u/ (public pages, always live), and any
 * request that is not GET. Your data is therefore never stored here. Offline drafts live in the page
 * itself (localStorage) and are removed when you sign out.
 *
 * Pages are fetched from the network first, so a new release shows up at once. The saved copy is only
 * used when the network fails. Built files in /_astro/ have a hash in their name, so they are saved once.
 */
const CACHE = "linkbeam-shell-v1";
const SHELL = ["/dashboard", "/offline.css", "/offline.js", "/favicon.svg", "/manifest.webmanifest", "/icons/icon-192.png"];
const MAX_ENTRIES = 120;

function isOurs(url) {
  return url.origin === self.location.origin && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/u/");
}

async function remember(cache, request, response) {
  if (response && response.ok && !response.redirected && response.type === "basic") {
    await cache.put(request, response.clone());
  }
}

// Finds the built files a page or style sheet needs, so the dashboard works offline right after install.
function assetsIn(text) {
  const found = new Set();
  const pattern = /["'(=](\/(?:_astro|fonts)\/[A-Za-z0-9_.-]+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) found.add(match[1]);
  return [...found];
}

// Some hosts answer /offline.html with a redirect to /offline. A browser will not show a redirected answer for a
// page visit, so the offline page is saved as a plain copy of the final answer.
async function saveOfflinePage(cache) {
  const response = await fetch("/offline.html");
  if (!response.ok) return;
  await cache.put("/offline.html", new Response(await response.blob(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
}

async function precache() {
  const cache = await caches.open(CACHE);
  await saveOfflinePage(cache).catch(() => undefined);
  await Promise.all(SHELL.map((path) => cache.add(path).catch(() => undefined)));
  const page = await cache.match("/dashboard");
  if (!page) return;
  const files = assetsIn(await page.clone().text());
  await Promise.all(files.map((path) => cache.add(path).catch(() => undefined)));
  // Style sheets name the font files they need, so keep those too.
  for (const path of files.filter((file) => file.endsWith(".css"))) {
    const sheet = await cache.match(path);
    if (!sheet) continue;
    const fonts = assetsIn(await sheet.clone().text().then((text) => text.replace(/url\(\s*/g, "(")));
    await Promise.all(fonts.map((font) => cache.add(font).catch(() => undefined)));
  }
}

async function trim() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const extra = keys.length - MAX_ENTRIES;
  for (let index = 0; index < extra; index += 1) await cache.delete(keys[index]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isOurs(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const response = await fetch(request);
          await remember(cache, request, response);
          return response;
        } catch {
          return (
            (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match("/offline.html")) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Built files, fonts and icons: saved copy first, because their names change when their content changes.
  if (/^\/(_astro|fonts|icons)\//.test(url.pathname) || url.pathname === "/favicon.svg") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const saved = await cache.match(request);
        if (saved) return saved;
        const response = await fetch(request);
        await remember(cache, request, response);
        event.waitUntil(trim());
        return response;
      })(),
    );
  }
});
