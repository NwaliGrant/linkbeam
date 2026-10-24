import { DEFAULT_LOCALE, PAGE_THEMES, linkHref, readableOn, resolveAppearance, translator, type BgStyle, type ButtonShape, type FontPair, type LinkKind, type ThemeId } from "@linkbeam/shared";

/** What the page needs. Built from database rows by the route, so this file never touches the database. */
export interface PublicPageData {
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  theme: ThemeId;
  accent: string | null;
  button_shape: ButtonShape;
  font_pair: FontPair;
  bg_style: BgStyle;
  show_badge: boolean;
  links: Array<{ id: string; kind: LinkKind; title: string; target: string; message: string | null }>;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Every piece of user text goes through this before it enters the page. */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

// Lucide icons (ISC licence). Only the shapes are kept, so each icon costs a few hundred bytes.
const ICONS: Partial<Record<LinkKind, string>> = {
  whatsapp: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  call: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  email: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  map: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
};

function icon(kind: LinkKind): string {
  const shapes = ICONS[kind];
  return shapes
    ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`
    : "";
}

/** The small script that counts a page view and link clicks. It sends only the page name and the link id. */
export const BEACON_SCRIPT =
  "(function(){var u=document.body.getAttribute('data-u');" +
  "function s(d){var b=JSON.stringify(d);" +
  "if(navigator.sendBeacon&&navigator.sendBeacon('/api/v1/track',new Blob([b],{type:'application/json'})))return;" +
  "try{fetch('/api/v1/track',{method:'POST',headers:{'content-type':'application/json'},body:b,keepalive:true}).catch(function(){})}catch(e){}}" +
  "s({page:u});" +
  "function c(e){var a=e.target&&e.target.closest?e.target.closest('a[data-l]'):null;if(a)s({page:u,link:a.getAttribute('data-l')})}" +
  "document.addEventListener('click',c);document.addEventListener('auxclick',c)})();";

const FONT_FILES = {
  inter: ["inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"],
  jakarta: ["plus-jakarta-sans-latin-wght-normal.woff2", "plus-jakarta-sans-latin-ext-wght-normal.woff2"],
} as const;

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

function fontFace(family: string, weights: string, files: readonly [string, string]): string {
  const face = (file: string, range: string): string =>
    `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${weights};src:url(/fonts/${file}) format("woff2");unicode-range:${range}}`;
  return face(files[1], LATIN_EXT) + face(files[0], LATIN);
}

const BASE_CSS =
  "*{box-sizing:border-box}" +
  "body{margin:0;min-height:100vh;background-color:var(--p-bg);background-image:var(--p-bg-image);background-size:var(--p-bg-size);color:var(--p-text);font-family:var(--p-font-body);font-size:16px;line-height:1.5;-webkit-text-size-adjust:100%}" +
  "main{max-width:32rem;margin:0 auto;padding:40px 16px 24px;display:flex;flex-direction:column;align-items:center;text-align:center}" +
  ".av{width:96px;height:96px;border-radius:50%;object-fit:cover;background:var(--p-button);color:var(--p-on-button);display:flex;align-items:center;justify-content:center;font:700 40px/1 var(--p-font-heading)}" +
  "h1{font:800 1.5rem/1.25 var(--p-font-heading);margin:16px 0 4px;overflow-wrap:anywhere}" +
  "h1+ul,h1+.none{margin-top:20px}.bio{margin:0 0 24px;color:var(--p-muted);overflow-wrap:anywhere;white-space:pre-line}" +
  "ul{list-style:none;margin:0;padding:0;width:100%;display:grid;gap:12px}" +
  ".b{display:flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:12px 20px;border-radius:var(--p-radius);background:var(--p-button);color:var(--p-on-button);font-weight:600;text-decoration:none;overflow-wrap:anywhere;transition:transform .15s}" +
  ".b:hover{transform:translateY(-1px)}" +
  ".b:focus-visible,.f a:focus-visible{outline:3px solid var(--p-text);outline-offset:3px}" +
  ".none{color:var(--p-muted);margin:0}" +
  ".f{margin-top:32px;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 16px}" +
  ".f a{display:inline-flex;align-items:center;min-height:44px;padding:0 8px;color:var(--p-muted);text-decoration:underline}" +
  "@media (prefers-reduced-motion:reduce){.b{transition:none}.b:hover{transform:none}}";

type T = ReturnType<typeof translator>;

function metaDescription(data: PublicPageData, t: T): string {
  const name = data.display_name || `@${data.username}`;
  return data.bio.trim() ? data.bio.trim().replace(/\s+/g, " ").slice(0, 160) : t("public.description.default", { name });
}

export interface RenderOptions {
  /** Public origin of the site, without a trailing slash. */
  origin: string;
  /** Language of the words around the owner's own text. Defaults to English. */
  locale?: string;
}

export function renderPublicPage(data: PublicPageData, options: RenderOptions): string {
  const { vars } = resolveAppearance(data);
  const theme = PAGE_THEMES[data.theme];
  const dark = readableOn(theme.bg) === "#FFFFFF";
  const locale = options.locale ?? DEFAULT_LOCALE;
  const t = translator(locale);
  const name = data.display_name || `@${data.username}`;
  const url = `${options.origin}/u/${encodeURIComponent(data.username)}`;
  const description = metaDescription(data, t);
  const title = data.display_name
    ? t("public.title.withName", { name: data.display_name, username: data.username })
    : t("public.title.plain", { username: data.username });
  const image = data.avatar_url ? `${options.origin}${data.avatar_url}` : `${options.origin}/og-default.png`;
  const card = data.avatar_url ? "summary" : "summary_large_image";

  const css = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(";");
  const fonts =
    data.font_pair === "friendly"
      ? fontFace("Plus Jakarta Sans", "200 800", FONT_FILES.jakarta) + fontFace("Inter", "100 900", FONT_FILES.inter)
      : fontFace("Inter", "100 900", FONT_FILES.inter);
  const preload =
    (data.font_pair === "friendly" ? `<link rel="preload" href="/fonts/${FONT_FILES.jakarta[0]}" as="font" type="font/woff2" crossorigin>` : "") +
    `<link rel="preload" href="/fonts/${FONT_FILES.inter[0]}" as="font" type="font/woff2" crossorigin>`;

  const items: string[] = [];
  for (const link of data.links) {
    const href = linkHref(link.kind, link.target, link.message);
    if (href === null) continue;
    const external = href.startsWith("http");
    const rel = external ? ' rel="noopener noreferrer nofollow ugc"' : "";
    items.push(`<li><a class="b" href="${esc(href)}" data-l="${esc(link.id)}"${rel}>${icon(link.kind)}<span>${esc(link.title)}</span></a></li>`);
  }

  const initial = esc(Array.from(name.replace(/^@/, ""))[0]?.toUpperCase() ?? "?");
  const avatar = data.avatar_url
    ? `<img class="av" src="${esc(data.avatar_url)}" width="96" height="96" alt="${esc(name)}" fetchpriority="high">`
    : `<div class="av" aria-hidden="true">${initial}</div>`;

  return (
    `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title>` +
    `<meta name="description" content="${esc(description)}">` +
    `<meta name="robots" content="index,follow">` +
    `<meta name="color-scheme" content="${dark ? "dark" : "light"}">` +
    `<meta name="theme-color" content="${esc(theme.bg)}">` +
    `<link rel="canonical" href="${esc(url)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml">` +
    `<meta property="og:type" content="profile"><meta property="og:site_name" content="Linkbeam">` +
    `<meta property="og:title" content="${esc(name)}"><meta property="og:description" content="${esc(description)}">` +
    `<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">` +
    `<meta name="twitter:card" content="${card}"><meta name="twitter:title" content="${esc(name)}">` +
    `<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">` +
    preload +
    `<style>${fonts}:root{${css}}${BASE_CSS}</style></head>` +
    `<body data-u="${esc(data.username)}"><main>${avatar}<h1>${esc(name)}</h1>` +
    (data.bio.trim() ? `<p class="bio">${esc(data.bio.trim())}</p>` : "") +
    (items.length > 0 ? `<ul>${items.join("")}</ul>` : `<p class="none">${esc(t("public.noLinks"))}</p>`) +
    `<div class="f"><a href="/report?page=${esc(encodeURIComponent(data.username))}" rel="nofollow">${esc(t("public.report"))}</a>` +
    (data.show_badge ? `<a href="/">${esc(t("public.badge"))}</a>` : "") +
    `</div></main><script>${BEACON_SCRIPT}</script></body></html>`
  );
}

export function renderNotFoundPage(locale: string = DEFAULT_LOCALE): string {
  const t = translator(locale);
  return messagePage(locale, t("public.notFound.title"), t("public.notFound.body"), "/", t("public.notFound.home"));
}

/** Shown to visitors when the server fails while making a page. Plain words, one way forward, no technical detail. */
export function renderErrorPage(locale: string = DEFAULT_LOCALE): string {
  const t = translator(locale);
  return messagePage(locale, t("public.error.title"), t("public.error.body"), "", t("public.error.retry"));
}

function messagePage(locale: string, title: string, body: string, href: string, action: string): string {
  return (
    `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)} | Linkbeam</title><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><link rel="icon" href="/favicon.svg" type="image/svg+xml">` +
    `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.5 system-ui,sans-serif;background:#F6FAF4;color:#0E1A13;text-align:center}` +
    `@media (prefers-color-scheme:dark){body{background:#0E1A13;color:#F6FAF4}a{color:#8BE04E!important}}` +
    `h1{font-size:1.5rem;margin:0 0 8px}p{margin:0 0 16px}a{display:inline-flex;align-items:center;min-height:44px;color:#0B6B3A;font-weight:600}</style></head>` +
    `<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p><a href="${esc(href)}">${esc(action)}</a></main></body></html>`
  );
}
