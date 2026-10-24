import { useRef, useState } from "preact/hooks";
import { Plus } from "lucide-preact";
import { MAX_LINKS_PER_USER } from "@linkbeam/shared";
import type { LinkItem, LinkPatch, NewLink } from "../lib/api";
import { indexAtY } from "../lib/reorder";
import AddLinkForm from "./AddLinkForm";
import LinkCard from "./LinkCard";

interface Props {
  links: LinkItem[];
  onCreate: (link: NewLink) => Promise<void>;
  onChange: (id: string, patch: LinkPatch, immediate?: boolean) => void;
  onMove: (from: number, to: number, commit: boolean) => void;
  onDelete: (id: string) => void;
}

export default function LinksTab({ links, onCreate, onChange, onMove, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; index: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const full = links.length >= MAX_LINKS_PER_USER;

  function move(from: number, to: number, commit: boolean): void {
    onMove(from, to, commit);
    const moved = links[from];
    if (commit && moved) setAnnouncement(`${moved.title} moved to position ${to + 1} of ${links.length}.`);
  }

  function startDrag(link: LinkItem, index: number, event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDragging({ id: link.id, index });
  }

  function dragMove(event: PointerEvent): void {
    if (!dragging || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>("[data-link-row]")];
    const middles = rows.map((row) => {
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    const target = indexAtY(middles, event.clientY);
    if (target !== dragging.index) {
      onMove(dragging.index, target, false);
      setDragging({ id: dragging.id, index: target });
    }
  }

  function endDrag(): void {
    if (!dragging) return;
    const finished = dragging;
    setDragging(null);
    onMove(finished.index, finished.index, true);
    const moved = links[finished.index];
    if (moved) setAnnouncement(`${moved.title} moved to position ${finished.index + 1} of ${links.length}.`);
  }

  return (
    <>
      <div class="panel-head">
        <div>
          <h2 id="links-heading">Your links</h2>
          <p class="muted">{links.length} of {MAX_LINKS_PER_USER} used</p>
        </div>
        {!adding && (
          <button class="btn" type="button" disabled={full} onClick={() => setAdding(true)}>
            <Plus size={18} aria-hidden="true" /> Add link
          </button>
        )}
      </div>

      {full && <div class="notice">You have reached the limit of {MAX_LINKS_PER_USER} links. Delete one to add another.</div>}

      {adding && (
        <AddLinkForm
          onCreate={async (link) => {
            await onCreate(link);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {links.length === 0 && !adding && (
        <div class="card empty">
          <h3>No links yet</h3>
          <p class="muted">Add your first link. It can be your website, WhatsApp, a Buy me a coffee page or anything else.</p>
          <button class="btn" type="button" onClick={() => setAdding(true)}>
            <Plus size={18} aria-hidden="true" /> Add your first link
          </button>
        </div>
      )}

      <ol class="link-list" ref={list} aria-labelledby="links-heading">
        {links.map((link, index) => (
          <LinkCard
            key={link.id}
            link={link}
            index={index}
            count={links.length}
            dragging={dragging?.id === link.id}
            onChange={(patch, immediate) => onChange(link.id, patch, immediate)}
            onMove={move}
            onDelete={() => onDelete(link.id)}
            onDragStart={(event) => startDrag(link, index, event)}
            onDragMove={dragMove}
            onDragEnd={endDrag}
          />
        ))}
      </ol>
      <p class="sr-only" aria-live="polite">{announcement}</p>
    </>
  );
}
