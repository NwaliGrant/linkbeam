import { useState } from "preact/hooks";
import { checkUsername } from "@linkbeam/shared";
import { ApiFailure, api, type Profile } from "../lib/api";

interface Props {
  profile: Profile;
  onUsernameSaved: (profile: Profile) => void;
}

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SettingsTab({ profile, onUsernameSaved }: Props) {
  const [username, setUsername] = useState(profile.username ?? "");
  const [usernameProblem, setUsernameProblem] = useState("");
  const [usernameSaved, setUsernameSaved] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const word = profile.username ?? "delete";

  async function saveUsername(event: Event): Promise<void> {
    event.preventDefault();
    setUsernameSaved(false);
    const checked = checkUsername(username);
    if (!checked.ok) return setUsernameProblem(checked.reason);
    if (checked.username === profile.username) return setUsernameProblem("This is already your username.");
    setBusy(true);
    try {
      const updated = await api.patchMe({ username: checked.username });
      setUsernameProblem("");
      setUsername(updated.username ?? "");
      setUsernameSaved(true);
      onUsernameSaved(updated);
    } catch (error) {
      setUsernameProblem(error instanceof ApiFailure ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function describe(error: unknown): string {
    if (error instanceof ApiFailure && error.code === "reauth_required") {
      return "For your safety, please sign out, sign in again, and then try this within 10 minutes.";
    }
    return error instanceof ApiFailure ? error.message : "Something went wrong. Please try again.";
  }

  async function leave(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
      location.assign("/signin");
    } catch (error) {
      setMessage({ kind: "error", text: describe(error) });
      setBusy(false);
    }
  }

  async function exportData(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      saveFile(await api.exportData(), "linkbeam-export.json");
      setMessage({ kind: "ok", text: "Your data was downloaded." });
    } catch (error) {
      setMessage({ kind: "error", text: describe(error) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(): Promise<void> {
    setBusy(true);
    try {
      await api.deleteAccount();
      location.assign("/?deleted=1");
    } catch (error) {
      setMessage({ kind: "error", text: describe(error) });
      setBusy(false);
    }
  }

  return (
    <>
      {message && (
        <div class={`notice${message.kind === "error" ? " error" : ""}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </div>
      )}

      <section class="card" aria-labelledby="account-heading">
        <h3 id="account-heading">Account</h3>
        <p class="muted" style="margin:8px 0 16px">Signed in as <strong>{profile.email}</strong></p>
        <form onSubmit={saveUsername} noValidate>
          <div class="field">
            <label for="username">Username</label>
            <input
              id="username"
              class="input"
              value={username}
              autocapitalize="off"
              autocomplete="off"
              spellcheck={false}
              maxLength={30}
              aria-invalid={usernameProblem ? "true" : undefined}
              aria-describedby={usernameProblem ? "username-error" : "username-hint"}
              onInput={(event) => { setUsername((event.target as HTMLInputElement).value); setUsernameSaved(false); }}
            />
            {usernameProblem ? <p class="error-message" id="username-error">{usernameProblem}</p> : <p class="hint" id="username-hint">3 to 30 letters, numbers, hyphens or underscores. You can change it once every 7 days.</p>}
            {usernameSaved && <p role="status" class="hint">Username saved.</p>}
          </div>
          <button class="btn" type="submit" disabled={busy}>Save username</button>
        </form>
      </section>

      <section class="card" aria-labelledby="session-heading">
        <h3 id="session-heading">Sign out</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-quiet" type="button" disabled={busy} onClick={() => leave(api.logout)}>Sign out</button>
          <button class="btn btn-quiet" type="button" disabled={busy} onClick={() => leave(api.logoutAll)}>Sign out of all devices</button>
        </div>
      </section>

      <section class="card" aria-labelledby="data-heading">
        <h3 id="data-heading">Your data</h3>
        <p class="muted" style="margin:8px 0 12px">Download a copy of your profile, links and stats. You must have signed in within the last 10 minutes.</p>
        <button class="btn btn-quiet" type="button" disabled={busy} onClick={exportData}>Download my data</button>
      </section>

      <section class="card" aria-labelledby="delete-heading">
        <h3 id="delete-heading" class="error-text">Delete account</h3>
        <p class="muted" style="margin:8px 0 12px">This permanently deletes your page, links, photo and stats. It cannot be undone.</p>
        <div class="field">
          <label for="confirm-delete">Type <strong>{word}</strong> to confirm</label>
          <input id="confirm-delete" class="input" value={confirm} autocapitalize="off" autocomplete="off" spellcheck={false} onInput={(event) => setConfirm((event.target as HTMLInputElement).value)} />
        </div>
        <button class="btn btn-danger" type="button" disabled={busy || confirm !== word} onClick={deleteAccount}>Delete my account</button>
      </section>
    </>
  );
}
