import { useState } from "preact/hooks";
import {
  ChevronDown,
  ChevronUp,
  Coffee,
  GripVertical,
  Link as LinkIcon,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Trash2,
} from "lucide-preact";
import { t, type LinkKind } from "@linkbeam/shared";
import type { LinkItem, LinkPatch } from "../lib/api";
import { KIND_LABELS, TARGET_HELP, checkTarget, titleProblem } from "../lib/linkKinds";
import { fromLocalInput, toLocalInput } from "../lib/time";

const ICONS: Record<LinkKind, typeof LinkIcon> = {
  url: LinkIcon,
  whatsapp: MessageCircle,
  coffee: Coffee,
  call: Phone,
  email: Mail,
  map: MapPin,
};

interface Props {
  link: LinkItem;
  index: number;
  count: number;
  dragging: boolean;
  onChange: (patch: LinkPatch, immediate?: boolean) => void;
  onMove: (from: number, to: number, commit: boolean) => void;
  onDelete: () => void;
  onDragStart: (event: PointerEvent) => void;
  onDragMove: (event: PointerEvent) => void;
  onDragEnd: (event: PointerEvent) => void;
}

export default function LinkCard(props: Props) {
  const { link, index, count } = props;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(link.title);
  const [target, setTarget] = useState(link.target);
  const [message, setMessage] = useState(link.message ?? "");
  const [starts, setStarts] = useState(toLocalInput(link.starts_at));
  const [ends, setEnds] = useState(toLocalInput(link.ends_at));
  const [errors, setErrors] = useState<{ title?: string; target?: string; schedule?: string }>({});
  const Icon = ICONS[link.kind];
  const help = TARGET_HELP[link.kind];
  const id = `link-${link.id}`;

  function editTitle(value: string): void {
    setTitle(value);
    const problem = titleProblem(value);
    setErrors((e) => ({ ...e, title: problem ?? undefined }));
    if (!problem) props.onChange({ title: value.trim() });
  }

  function editTarget(value: string): void {
    setTarget(value);
    const result = checkTarget(link.kind, value);
    setErrors((e) => ({ ...e, target: result.ok ? undefined : result.problem }));
    if (result.ok) props.onChange({ target: result.value });
  }

  function editMessage(value: string): void {
    setMessage(value);
    if (value.length <= 300) props.onChange({ message: value.trim() === "" ? null : value.trim() });
  }

  function editSchedule(nextStarts: string, nextEnds: string): void {
    setStarts(nextStarts);
    setEnds(nextEnds);
    const a = fromLocalInput(nextStarts);
    const b = fromLocalInput(nextEnds);
    if (a !== null && b !== null && a >= b) {
      setErrors((e) => ({ ...e, schedule: "The end must be after the start." }));
      return;
    }
    setErrors((e) => ({ ...e, schedule: undefined }));
    props.onChange({ starts_at: a, ends_at: b }, true);
  }

  return (
    <li class={`card link-card${props.dragging ? " dragging" : ""}`} data-link-row>
      <div class="link-row">
        <button
          type="button"
          class="btn btn-quiet btn-icon handle"
          aria-label={`Drag to move ${link.title}. Or use the arrow buttons.`}
          onPointerDown={props.onDragStart}
          onPointerMove={props.onDragMove}
          onPointerUp={props.onDragEnd}
          onPointerCancel={props.onDragEnd}
        >
          <GripVertical size={20} aria-hidden="true" />
        </button>
        <div class="link-summary">
          <strong>
            <Icon size={16} aria-hidden="true" style="vertical-align:-2px" /> {link.title}
          </strong>
          <span>{link.target}</span>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={link.enabled}
            onChange={(event) => props.onChange({ enabled: (event.target as HTMLInputElement).checked }, true)}
          />
          <span>{link.enabled ? "On" : "Off"}</span>
          <span class="sr-only">: show {link.title} on your page</span>
        </label>
      </div>

      <div class="link-actions">
        <button type="button" class="btn btn-quiet btn-icon" disabled={index === 0} aria-label={`Move ${link.title} up`} onClick={() => props.onMove(index, index - 1, true)}>
          <ChevronUp size={20} aria-hidden="true" />
        </button>
        <button type="button" class="btn btn-quiet btn-icon" disabled={index === count - 1} aria-label={`Move ${link.title} down`} onClick={() => props.onMove(index, index + 1, true)}>
          <ChevronDown size={20} aria-hidden="true" />
        </button>
        <button type="button" class="btn btn-quiet" aria-expanded={open} aria-controls={`${id}-details`} onClick={() => setOpen(!open)}>
          <Pencil size={16} aria-hidden="true" /> {open ? "Close" : "Edit"}
          <span class="sr-only"> {link.title}</span>
        </button>
        <button type="button" class="btn btn-danger" onClick={props.onDelete}>
          <Trash2 size={16} aria-hidden="true" /> Delete
          <span class="sr-only"> {link.title}</span>
        </button>
      </div>

      {open && (
        <div class="link-details" id={`${id}-details`}>
          <p class="hint">{KIND_LABELS[link.kind]}</p>
          <div class="field">
            <label for={`${id}-title`}>Title</label>
            <input
              id={`${id}-title`}
              class="input"
              value={title}
              maxLength={80}
              aria-invalid={errors.title ? "true" : undefined}
              aria-describedby={errors.title ? `${id}-title-error` : undefined}
              onInput={(event) => editTitle((event.target as HTMLInputElement).value)}
            />
            {errors.title && <p class="error-message" id={`${id}-title-error`}>{errors.title}</p>}
          </div>
          <div class="field">
            <label for={`${id}-target`}>{help.label}</label>
            <input
              id={`${id}-target`}
              class="input"
              value={target}
              inputMode={help.inputMode}
              autocapitalize="off"
              spellcheck={false}
              aria-invalid={errors.target ? "true" : undefined}
              aria-describedby={errors.target ? `${id}-target-error` : `${id}-target-hint`}
              onInput={(event) => editTarget((event.target as HTMLInputElement).value)}
            />
            {errors.target ? <p class="error-message" id={`${id}-target-error`}>{errors.target}</p> : <p class="hint" id={`${id}-target-hint`}>{help.hint}</p>}
          </div>
          {link.kind === "whatsapp" && (
            <div class="field">
              <label for={`${id}-message`}>{t("link.whatsapp.message")}</label>
              <textarea id={`${id}-message`} class="input" value={message} maxLength={300} onInput={(event) => editMessage((event.target as HTMLTextAreaElement).value)} />
              <p class="hint">People will see this text ready to send. {message.length} of 300.</p>
            </div>
          )}
          <fieldset>
            <legend>Show only between these times (optional)</legend>
            <div class="field">
              <label for={`${id}-starts`}>Start</label>
              <input id={`${id}-starts`} class="input" type="datetime-local" value={starts} onInput={(event) => editSchedule((event.target as HTMLInputElement).value, ends)} />
            </div>
            <div class="field">
              <label for={`${id}-ends`}>End</label>
              <input
                id={`${id}-ends`}
                class="input"
                type="datetime-local"
                value={ends}
                aria-invalid={errors.schedule ? "true" : undefined}
                aria-describedby={errors.schedule ? `${id}-schedule-error` : undefined}
                onInput={(event) => editSchedule(starts, (event.target as HTMLInputElement).value)}
              />
              {errors.schedule && <p class="error-message" id={`${id}-schedule-error`}>{errors.schedule}</p>}
              <p class="hint">Times use your device's time zone.</p>
            </div>
          </fieldset>
        </div>
      )}
    </li>
  );
}
