export interface TurnstileApi {
  render(element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }): string;
  reset(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Loads Cloudflare's bot check only on pages that need it, and only when a site key is set. */
export function loadTurnstile(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    script.onerror = () => reject(new Error("blocked"));
    document.head.appendChild(script);
  });
}
