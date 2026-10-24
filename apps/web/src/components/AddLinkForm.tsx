import { useRef, useState } from "preact/hooks";
import { LINK_KINDS, t, type LinkKind } from "@linkbeam/shared";
import { ApiFailure, type NewLink } from "../lib/api";
import { KIND_LABELS, TARGET_HELP, checkTarget, titleProblem } from "../lib/linkKinds";

interface Props {
  onCreate: (link: NewLink) => Promise<void>;
  onCancel?: () => void;
  /** Used by onboarding to say "Add and finish". */
  submitLabel?: string;
  idPrefix?: string;
}

export default function AddLinkForm({ onCreate, onCancel, submitLabel = "Add link", idPrefix = "new" }: Props) {
  const [kind, setKind] = useState<LinkKind>("url");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ title?: string; target?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const help = TARGET_HELP[kind];

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const titleError = titleProblem(title);
    const checked = checkTarget(kind, target);
    if (titleError || !checked.ok) {
      setErrors({ title: titleError ?? undefined, target: checked.ok ? undefined : checked.problem });
      (titleError ? titleInput : targetInput).current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onCreate({ kind, title: title.trim(), target: checked.value, ...(kind === "whatsapp" && message.trim() ? { message: message.trim() } : {}) });
      setTitle("");
      setTarget("");
      setMessage("");
    } catch (error) {
      setErrors({ form: error instanceof ApiFailure ? error.message : "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="card" onSubmit={submit} noValidate aria-label="Add a link">
      {errors.form && <div class="notice error" role="alert">{errors.form}</div>}
      <div class="field">
        <label for={`${idPrefix}-kind`}>Type of link</label>
        <select id={`${idPrefix}-kind`} class="input" value={kind} onChange={(event) => { setKind((event.target as HTMLSelectElement).value as LinkKind); setErrors({}); }}>
          {LINK_KINDS.map((value) => (
            <option value={value} key={value}>{KIND_LABELS[value]}</option>
          ))}
        </select>
      </div>
      <div class="field">
        <label for={`${idPrefix}-title`}>Title</label>
        <input
          id={`${idPrefix}-title`}
          ref={titleInput}
          class="input"
          value={title}
          maxLength={80}
          placeholder="My shop"
          aria-invalid={errors.title ? "true" : undefined}
          aria-describedby={errors.title ? `${idPrefix}-title-error` : undefined}
          onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
        />
        {errors.title && <p class="error-message" id={`${idPrefix}-title-error`}>{errors.title}</p>}
      </div>
      <div class="field">
        <label for={`${idPrefix}-target`}>{help.label}</label>
        <input
          id={`${idPrefix}-target`}
          ref={targetInput}
          class="input"
          value={target}
          placeholder={help.placeholder}
          inputMode={help.inputMode}
          autocapitalize="off"
          spellcheck={false}
          aria-invalid={errors.target ? "true" : undefined}
          aria-describedby={errors.target ? `${idPrefix}-target-error` : `${idPrefix}-target-hint`}
          onInput={(event) => setTarget((event.target as HTMLInputElement).value)}
        />
        {errors.target ? <p class="error-message" id={`${idPrefix}-target-error`}>{errors.target}</p> : <p class="hint" id={`${idPrefix}-target-hint`}>{help.hint}</p>}
      </div>
      {kind === "whatsapp" && (
        <div class="field">
          <label for={`${idPrefix}-message`}>{t("link.whatsapp.message")}</label>
          <textarea id={`${idPrefix}-message`} class="input" value={message} maxLength={300} onInput={(event) => setMessage((event.target as HTMLTextAreaElement).value)} />
        </div>
      )}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" type="submit" disabled={busy}>{busy ? "Adding…" : submitLabel}</button>
        {onCancel && <button class="btn btn-quiet" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
