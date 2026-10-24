import { useEffect, useRef, useState } from "preact/hooks";
import { normalizeEmail } from "@linkbeam/shared";
import { ApiFailure, api } from "../lib/api";
import { GITHUB_ICON_PATH, GOOGLE_ICON_PATH } from "../lib/brandIcons";
import { loadTurnstile } from "../lib/turnstile";

interface Props {
  turnstileSiteKey: string;
}

type Phase = "idle" | "sending" | "sent";

const URL_ERRORS: Record<string, string> = {
  invalid_link: "That sign-in link did not work. It may have expired or been used already. Please ask for a new one.",
  rate_limited: "Too many new accounts were made from your network today. Please try again tomorrow.",
  provider_unavailable: "That sign-in method is not available yet. Please use your email.",
};

function Brand({ path }: { path: string }) {
  return (
    <svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export default function SignIn({ turnstileSiteKey }: Props) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState("");
  const [token, setToken] = useState("");
  // The button stays off until this code is running, so an early tap cannot reload the page by mistake.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Someone may have started typing before this code loaded. Keep what they typed.
    const typed = (document.getElementById("email") as HTMLInputElement | null)?.value;
    if (typed) setEmail(typed);
    setReady(true);
  }, []);
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const sentHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("error");
    if (code && URL_ERRORS[code]) setProblem(URL_ERRORS[code]);
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey || !widget.current) return;
    const element = widget.current;
    loadTurnstile()
      .then((turnstile) => {
        widgetId.current = turnstile.render(element, {
          sitekey: turnstileSiteKey,
          callback: (value) => {
            setToken(value);
            setBotCheckFailed(false);
          },
          "expired-callback": () => setToken(""),
          "error-callback": () => setBotCheckFailed(true),
        });
      })
      .catch(() => setBotCheckFailed(true));
  }, [turnstileSiteKey]);

  useEffect(() => {
    if (phase === "sent") sentHeading.current?.focus();
  }, [phase]);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const clean = normalizeEmail(email);
    if (clean === null) {
      setProblem("Enter a valid email address, for example name@example.com.");
      return;
    }
    if (turnstileSiteKey && !token) {
      setProblem("Please finish the check below the email box first.");
      return;
    }
    setProblem("");
    setPhase("sending");
    try {
      await api.requestMagicLink(clean, token || undefined);
      setPhase("sent");
    } catch (error) {
      setPhase("idle");
      if (turnstileSiteKey) {
        window.turnstile?.reset(widgetId.current);
        setToken("");
      }
      if (error instanceof ApiFailure && error.code === "rate_limited") {
        setProblem("Too many tries. Please wait a few minutes and try again.");
      } else if (error instanceof ApiFailure && error.code === "turnstile_failed") {
        setProblem("We could not confirm you are a person. Please try the check again.");
      } else {
        setProblem(error instanceof ApiFailure ? error.message : "Something went wrong. Please try again.");
      }
    }
  }

  if (phase === "sent") {
    return (
      <main class="auth-shell">
        <div class="card auth-card" role="status">
          <h1 tabIndex={-1} ref={sentHeading}>Check your email</h1>
          <p>
            If <strong>{email.trim()}</strong> can receive email, we sent a sign-in link. Open your email app and tap the link.
          </p>
          <p class="hint">The link works once and expires in 15 minutes. Look in your spam folder if you do not see it.</p>
          <button type="button" class="btn btn-quiet" onClick={() => setPhase("idle")}>
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main class="auth-shell">
      <div class="card auth-card">
        <h1>Sign in to Linkbeam</h1>
        <p class="muted" style="text-align:center">New here? Enter your email and we will make your account.</p>

        {problem && (
          <div class="notice error" role="alert" id="signin-problem">
            {problem}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div class="field">
            <label for="email">Email address</label>
            <input
              id="email"
              class="input"
              type="email"
              inputMode="email"
              autocomplete="email"
              autocapitalize="off"
              required
              value={email}
              aria-invalid={problem && !email ? "true" : undefined}
              aria-describedby={problem ? "signin-problem" : undefined}
              onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
            />
          </div>
          {turnstileSiteKey && (
            <div class="field">
              <div ref={widget} />
              {botCheckFailed && (
                <p class="error-message">The check could not load. Turn off any blocker for this page and reload it.</p>
              )}
            </div>
          )}
          <button class="btn btn-block" type="submit" disabled={!ready || phase === "sending"}>
            {phase === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>

        <div class="divider">or</div>
        <div class="social">
          <a class="btn btn-quiet btn-block" href="/api/v1/auth/google/start">
            <Brand path={GOOGLE_ICON_PATH} /> Continue with Google
          </a>
          <a class="btn btn-quiet btn-block" href="/api/v1/auth/github/start">
            <Brand path={GITHUB_ICON_PATH} /> Continue with GitHub
          </a>
        </div>
      </div>
    </main>
  );
}
