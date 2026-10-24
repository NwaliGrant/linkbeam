import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Copy, Download, ExternalLink, Mail, MessageCircle, Send, Share2 } from "lucide-preact";

interface Props {
  username: string | null;
  onChooseUsername: () => void;
}

type Matrix = boolean[][];

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ShareTab({ username, onChooseUsername }: Props) {
  const [copied, setCopied] = useState<"" | "yes" | "manual">("");
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [qrProblem, setQrProblem] = useState("");
  const [qrSvgUrl, setQrSvgUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pageUrl = username ? `${location.origin}/u/${username}` : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // The QR code library is loaded only when this tab opens, so the editor itself stays light.
  useEffect(() => {
    if (!pageUrl) return;
    let cancelled = false;
    import("../lib/qr").then(
      (qr) => {
        if (cancelled) return;
        const made = qr.qrMatrix(pageUrl);
        setMatrix(made);
        setQrSvgUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.qrSvg(made, 512))}`);
      },
      () => !cancelled && setQrProblem("The QR code could not be made. Please reload the page."),
    );
    return () => {
      cancelled = true;
    };
  }, [pageUrl]);

  if (!username) {
    return (
      <>
        <div class="panel-head"><h2>Share</h2></div>
        <div class="card empty">
          <h3>Choose a username first</h3>
          <p class="muted">Your username is the end of your link. Pick one, and then you can share your page.</p>
          <button type="button" class="btn" onClick={onChooseUsername}>Choose a username</button>
        </div>
      </>
    );
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied("yes");
    } catch {
      input.current?.select();
      setCopied("manual");
    }
    setTimeout(() => setCopied(""), 4000);
  }

  async function downloadPng(): Promise<void> {
    if (!matrix) return;
    try {
      const qr = await import("../lib/qr");
      saveFile(await qr.qrPng(matrix), `linkbeam-${username}-qr.png`);
    } catch {
      setQrProblem("The PNG could not be made. Try the SVG download instead.");
    }
  }

  async function downloadSvg(): Promise<void> {
    if (!matrix) return;
    const qr = await import("../lib/qr");
    saveFile(new Blob([qr.qrSvg(matrix)], { type: "image/svg+xml" }), `linkbeam-${username}-qr.svg`);
  }

  const text = "Find all my links in one place:";
  const enc = encodeURIComponent;
  const targets: Array<{ label: string; href: string; Icon: typeof Send }> = [
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(`${text} ${pageUrl}`)}`, Icon: MessageCircle },
    { label: "Telegram", href: `https://t.me/share/url?url=${enc(pageUrl)}&text=${enc(text)}`, Icon: Send },
    { label: "X", href: `https://twitter.com/intent/tweet?url=${enc(pageUrl)}&text=${enc(text)}`, Icon: ExternalLink },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(pageUrl)}`, Icon: ExternalLink },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(pageUrl)}`, Icon: ExternalLink },
    { label: "Email", href: `mailto:?subject=${enc("My links")}&body=${enc(`${text}\n${pageUrl}`)}`, Icon: Mail },
  ];

  return (
    <>
      <div class="panel-head"><h2>Share</h2></div>

      <section class="card" aria-labelledby="share-link-heading">
        <h3 id="share-link-heading">Your link</h3>
        <div class="field share-field">
          <label for="share-url">Your page address</label>
          <div class="share-row">
            <input id="share-url" ref={input} class="input" readOnly value={pageUrl} onFocus={(event) => (event.target as HTMLInputElement).select()} />
            <button type="button" class="btn" onClick={copy}>
              {copied === "yes" ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />} Copy link
            </button>
          </div>
          <p class="hint" role="status">
            {copied === "yes" && "Link copied."}
            {copied === "manual" && "Press Ctrl+C (or Copy on your phone) to copy the selected link."}
          </p>
        </div>
        <a class="btn btn-quiet" href={pageUrl} target="_blank" rel="noopener">
          <ExternalLink size={18} aria-hidden="true" /> Open your page
        </a>
      </section>

      <section class="card" aria-labelledby="share-qr-heading">
        <h3 id="share-qr-heading">QR code</h3>
        <p class="muted">Print it on a card, a flyer or a shop window. Phones open your page when they scan it.</p>
        {qrProblem && <p class="error-message" role="alert">{qrProblem}</p>}
        <div class="qr-box">
          {qrSvgUrl ? (
            <img src={qrSvgUrl} width="200" height="200" alt={`QR code for ${pageUrl}`} />
          ) : (
            <div class="skeleton" style="width:200px;height:200px" aria-busy="true" aria-label="Making your QR code" />
          )}
        </div>
        <div class="share-actions">
          <button type="button" class="btn" disabled={!matrix} onClick={downloadPng}><Download size={18} aria-hidden="true" /> Download PNG</button>
          <button type="button" class="btn btn-quiet" disabled={!matrix} onClick={downloadSvg}><Download size={18} aria-hidden="true" /> Download SVG</button>
        </div>
        <p class="hint">PNG is best for phones and documents. SVG stays sharp at any size, which is best for printing.</p>
      </section>

      <section class="card" aria-labelledby="share-social-heading">
        <h3 id="share-social-heading">Share your page</h3>
        <div class="share-actions">
          {canShare && (
            <button type="button" class="btn" onClick={() => navigator.share({ title: "My links", text, url: pageUrl }).catch(() => undefined)}>
              <Share2 size={18} aria-hidden="true" /> Share…
            </button>
          )}
          {targets.map(({ label, href, Icon }) => (
            <a key={label} class="btn btn-quiet" href={href} target="_blank" rel="noopener noreferrer">
              <Icon size={18} aria-hidden="true" /> {label}
            </a>
          ))}
        </div>
      </section>

      <section class="card" aria-labelledby="share-bio-heading">
        <h3 id="share-bio-heading">Add your link to Instagram</h3>
        <ol class="steps">
          <li>Copy your link above.</li>
          <li>Open Instagram, go to your profile and tap <strong>Edit profile</strong>.</li>
          <li>Tap <strong>Links</strong>, then <strong>Add external link</strong>.</li>
          <li>Paste your link, add a title such as “My links”, and save.</li>
        </ol>
        <p class="hint">TikTok, X, YouTube and WhatsApp Business also have a website or link field in the profile settings. Paste the same link there.</p>
      </section>
    </>
  );
}
