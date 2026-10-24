import { useEffect, useRef, useState } from "preact/hooks";
import { Camera } from "lucide-preact";
import { checkUsername } from "@linkbeam/shared";
import { ApiFailure, api, type LinkItem, type NewLink, type Profile } from "../lib/api";
import { prepareAvatar } from "../lib/avatar";
import AddLinkForm from "./AddLinkForm";

interface Props {
  profile: Profile;
  onProfile: (profile: Profile) => void;
  onLink: (link: LinkItem) => void;
  onFinish: () => void;
}

const STEPS = 3;

export default function Onboarding({ profile, onProfile, onLink, onFinish }: Props) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState(profile.username ?? "");
  const [name, setName] = useState(profile.display_name);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const next = (): void => {
    setProblem("");
    if (step === STEPS) onFinish();
    else setStep(step + 1);
  };

  async function claimUsername(event: Event): Promise<void> {
    event.preventDefault();
    const checked = checkUsername(username);
    if (!checked.ok) return setProblem(checked.reason);
    setBusy(true);
    try {
      if (checked.username !== profile.username) onProfile(await api.patchMe({ username: checked.username }));
      next();
    } catch (error) {
      setProblem(error instanceof ApiFailure ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveName(event: Event): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      if (name.trim() !== profile.display_name) onProfile(await api.patchMe({ display_name: name.trim() }));
      next();
    } catch (error) {
      setProblem(error instanceof ApiFailure ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true);
    setProblem("");
    try {
      const url = await api.uploadAvatar(await prepareAvatar(file));
      onProfile({ ...profile, avatar_url: url });
    } catch (error) {
      setProblem(error instanceof ApiFailure ? error.message : "We could not use that photo. Try a JPEG, PNG or WebP picture.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function createFirstLink(link: NewLink): Promise<void> {
    onLink(await api.createLink(link));
    onFinish();
  }

  return (
    <main class="onboarding">
      <div class="progress" role="progressbar" aria-label={`Step ${step} of ${STEPS}`} aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step}>
        <div style={{ width: `${(step / STEPS) * 100}%` }} />
      </div>
      <p class="muted">Step {step} of {STEPS}</p>

      {problem && <div class="notice error" role="alert">{problem}</div>}

      {step === 1 && (
        <form class="card" onSubmit={claimUsername} noValidate>
          <h1 tabIndex={-1} ref={heading}>Choose your username</h1>
          <p class="muted" style="margin:8px 0 16px">This will be your page address.</p>
          <div class="field">
            <label for="ob-username">Username</label>
            <input id="ob-username" class="input" value={username} autocapitalize="off" autocomplete="off" spellcheck={false} maxLength={30} onInput={(event) => setUsername((event.target as HTMLInputElement).value)} />
            <p class="hint">3 to 30 letters, numbers, hyphens or underscores.</p>
          </div>
          <button class="btn btn-block" type="submit" disabled={busy}>Continue</button>
        </form>
      )}

      {step === 2 && (
        <form class="card" onSubmit={saveName} noValidate>
          <h1 tabIndex={-1} ref={heading}>Your name and photo</h1>
          <div class="avatar-picker" style="margin:16px 0">
            {profile.avatar_url ? <img class="avatar-lg" src={profile.avatar_url} alt="Your photo" width="96" height="96" /> : <div class="avatar-lg" aria-hidden="true"><Camera size={32} /></div>}
            <div>
              <input ref={fileInput} class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" onChange={pickPhoto} />
              <button type="button" class="btn btn-quiet" disabled={busy} onClick={() => fileInput.current?.click()}>
                {profile.avatar_url ? "Change photo" : "Add a photo"}
              </button>
              <p class="hint" style="margin-top:4px">We make it smaller on your device first.</p>
            </div>
          </div>
          <div class="field">
            <label for="ob-name">Display name</label>
            <input id="ob-name" class="input" value={name} maxLength={60} autocomplete="name" onInput={(event) => setName((event.target as HTMLInputElement).value)} />
          </div>
          <button class="btn btn-block" type="submit" disabled={busy}>Continue</button>
        </form>
      )}

      {step === 3 && (
        <div>
          <h1 tabIndex={-1} ref={heading} style="margin-bottom:16px">Add your first link</h1>
          <AddLinkForm idPrefix="ob" submitLabel="Add link and finish" onCreate={createFirstLink} />
        </div>
      )}

      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">
        <button class="btn btn-quiet" type="button" onClick={next} disabled={busy}>Skip this step</button>
        <button class="btn btn-quiet" type="button" onClick={onFinish} disabled={busy}>Skip setup</button>
      </div>
    </main>
  );
}
