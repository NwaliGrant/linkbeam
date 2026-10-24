import { useEffect, useRef, useState } from "preact/hooks";
import { checkUsername } from "@linkbeam/shared";
import { ApiFailure, api } from "../lib/api";
import { loadTurnstile } from "../lib/turnstile";

interface Props {
  turnstileSiteKey: string;
}

type Phase = "idle" | "sending" | "sent";

export default function ReportForm({ turnstileSiteKey }: Props) {
  const [page, setPage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [token, setToken] = useState("");
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const checked = checkUsername(new URLSearchParams(location.search).get("page") ?? "");
    setPage(checked.ok ? checked.username : "");
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey || !widget.current || !page) return;
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
  }, [turnstileSiteKey, page]);

  useEffect(() => {
    if (phase === "sent") doneHeading.current?.focus();
  }, [phase]);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!page) return;
    const text = reason.trim();
    if (text.length === 0) return setProblem("Tell us what is wrong with this page.");
    if (text.length > 500) return setProblem("Use 500 characters or fewer.");
    if (turnstileSiteKey && !token) return setProblem("Please finish the check below first.");
    setProblem("");
    setPhase("sending");
    try {
      await api.report(page, text, token || undefined);
      setPhase("sent");
    } catch (error) {
      setPhase("idle");
      if (turnstileSiteKey) {
        window.turnstile?.reset(widgetId.current);
        setToken("");
      }
      if (error instanceof ApiFailure && error.code === "rate_limited") setProblem("Too many reports from your network. Please try again later.");
      else if (error instanceof ApiFailure && error.code === "turnstile_failed") setProblem("We could not confirm you are a person. Please try the check again.");
      else setProblem(error instanceof ApiFailure ? error.message : "Something went wrong. Please try again.");
    }
  }

  if (page === null) return <main class="auth-shell"><div class="card auth-card skeleton" style="height:240px" aria-busy="true" /></main>;

  if (page === "") {
    return (
      <main class="auth-shell">
        <div class="card auth-card">
          <h1>Report a page</h1>
          <p>We could not tell which page you want to report. Open the page and tap <strong>Report this page</strong> at the bottom.</p>
          <a class="btn btn-quiet" href="/">Go to Linkbeam</a>
        </div>
      </main>
    );
  }

  if (phase === "sent") {
    return (
      <main class="auth-shell">
        <div class="card auth-card" role="status">
          <h1 tabIndex={-1} ref={doneHeading}>Thank you</h1>
          <p>We received your report. A person will look at it. We do not tell the page owner who reported it.</p>
          <a class="btn btn-quiet" href="/">Go to Linkbeam</a>
        </div>
      </main>
    );
  }

  return (
    <main class="auth-shell">
      <form class="card auth-card" onSubmit={submit} noValidate>
        <h1>Report this page</h1>
        <p>You are reporting the page <strong>linkbeam/u/{page}</strong>. Use this for scams, harmful content, or someone pretending to be you.</p>
        <div class="field">
          <label for="reason">What is wrong with this page?</label>
          <textarea
            id="reason"
            class="input"
            value={reason}
            maxLength={500}
            aria-invalid={problem && !reason.trim() ? "true" : undefined}
            aria-describedby={problem ? "report-problem" : "report-count"}
            onInput={(event) => setReason((event.target as HTMLTextAreaElement).value)}
          />
          <div class="counter" id="report-count">{reason.length} / 500</div>
        </div>
        {turnstileSiteKey && (
          <div class="field">
            <div ref={widget} />
            {botCheckFailed && <p class="error-message" role="alert">The check could not load. Turn off any blocker for this page and reload.</p>}
          </div>
        )}
        {problem && <p class="error-message" id="report-problem" role="alert">{problem}</p>}
        <button class="btn btn-block" type="submit" disabled={phase === "sending"}>{phase === "sending" ? "Sending…" : "Send report"}</button>
        <p class="hint">Do not include passwords or private details. For an emergency, contact your local authorities.</p>
      </form>
    </main>
  );
}
