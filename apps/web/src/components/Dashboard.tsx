import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChartColumn, CircleAlert, Check, Eye, List, Palette, RefreshCw, Settings, Share2, WifiOff } from "lucide-preact";
import { ApiFailure, api, type LinkItem, type LinkPatch, type NewLink, type Profile, type ProfilePatch } from "../lib/api";
import { createAutosave, type SaveStatus } from "../lib/autosave";
import { applyDrafts, loadDrafts, loadSnapshot, saveDrafts, saveSnapshot, type Drafts } from "../lib/drafts";
import { moveItem } from "../lib/reorder";
import DesignTab from "./DesignTab";
import LinksTab from "./LinksTab";
import Onboarding from "./Onboarding";
import Preview from "./Preview";
import SettingsTab from "./SettingsTab";
import ShareTab from "./ShareTab";
import StatsTab from "./StatsTab";
import Toast from "./Toast";

type Tab = "links" | "design" | "preview" | "share" | "stats" | "settings";
type Boot = { state: "loading" } | { state: "error"; message: string } | { state: "ready" };

const UNDO_MS = 8000;
const SKIP_KEY = "linkbeam-skip-setup";

const TABS: Array<{ id: Tab; label: string; Icon: typeof List; mobileOnly?: boolean }> = [
  { id: "links", label: "Links", Icon: List },
  { id: "design", label: "Design", Icon: Palette },
  { id: "preview", label: "Preview", Icon: Eye, mobileOnly: true },
  { id: "share", label: "Share", Icon: Share2 },
  { id: "stats", label: "Stats", Icon: ChartColumn },
  { id: "settings", label: "Settings", Icon: Settings },
];

function skipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Dashboard() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [tab, setTab] = useState<Tab>("links");
  const [status, setStatus] = useState<{ value: SaveStatus; message: string }>({ value: "idle", message: "" });
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [fromSnapshot, setFromSnapshot] = useState(false);

  const linksRef = useRef<LinkItem[]>([]);
  const pendingProfile = useRef<ProfilePatch>({});
  const pendingLinks = useRef(new Map<string, LinkPatch>());
  const pendingDelete = useRef<{ link: LinkItem; index: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const profileRef = useRef<Profile | null>(null);
  linksRef.current = links;
  profileRef.current = profile;

  /** Keeps unsent edits on this device, so a closed tab or a lost connection loses nothing. */
  const persistDrafts = useCallback((): void => {
    const current = profileRef.current;
    if (current) saveDrafts(current.id, pendingProfile.current, pendingLinks.current);
  }, []);

  const saver = useMemo(
    () => createAutosave({ delay: 600, onStatus: (value, message) => setStatus({ value, message: message ?? "" }) }),
    [],
  );

  const profileJob = useCallback(
    async (): Promise<void> => {
      const body = pendingProfile.current;
      pendingProfile.current = {};
      try {
        await api.patchMe(body);
      } catch (error) {
        pendingProfile.current = { ...body, ...pendingProfile.current };
        throw error;
      } finally {
        persistDrafts();
      }
    },
    [persistDrafts],
  );

  const linkJob = useCallback(
    (id: string) => async (): Promise<void> => {
      const body = pendingLinks.current.get(id);
      if (!body) return;
      pendingLinks.current.delete(id);
      try {
        await api.patchLink(id, body);
      } catch (error) {
        pendingLinks.current.set(id, { ...body, ...pendingLinks.current.get(id) });
        throw error;
      } finally {
        persistDrafts();
      }
    },
    [persistDrafts],
  );

  /** With quiet set, the screen stays as it is while fresh data arrives (used when the connection comes back). */
  const load = useCallback(
    (quiet = false) => {
      if (!quiet) setBoot({ state: "loading" });
      Promise.all([api.me(), api.links()]).then(
        ([me, list]) => {
          // Edits that never reached the server: from this device's storage at start-up, from memory afterwards.
          const waiting: Drafts | null = quiet
            ? { userId: me.id, profile: pendingProfile.current, links: Object.fromEntries(pendingLinks.current) }
            : loadDrafts(me.id);
          const applied = waiting ? applyDrafts(me, list, waiting) : null;
          setProfile(applied?.profile ?? me);
          setLinks(applied?.links ?? list);
          setFromSnapshot(false);
          if (applied && !quiet) {
            pendingProfile.current = applied.profilePatch;
            pendingLinks.current = applied.linkPatches;
            if (Object.keys(applied.profilePatch).length > 0) saver.schedule("profile", profileJob);
            for (const id of applied.linkPatches.keys()) saver.schedule(`link:${id}`, linkJob(id));
          }
          if (!quiet) {
            setOnboarding(me.username === null && list.length === 0 && !skipped());
            setBoot({ state: "ready" });
          }
        },
        (error) => {
          if (error instanceof ApiFailure && error.status === 401) {
            location.replace("/signin");
            return;
          }
          if (quiet) return;
          // No connection: open from the copy kept on this device, so editing can go on.
          const snapshot = error instanceof ApiFailure && error.status === 0 ? loadSnapshot() : null;
          if (snapshot) {
            const waiting = loadDrafts(snapshot.profile.id);
            const applied = waiting ? applyDrafts(snapshot.profile, snapshot.links, waiting) : null;
            setProfile(applied?.profile ?? snapshot.profile);
            setLinks(applied?.links ?? snapshot.links);
            if (applied) {
              pendingProfile.current = applied.profilePatch;
              pendingLinks.current = applied.linkPatches;
              // They fail while offline and are kept; "online" sends them.
              if (Object.keys(applied.profilePatch).length > 0) saver.schedule("profile", profileJob);
              for (const id of applied.linkPatches.keys()) saver.schedule(`link:${id}`, linkJob(id));
            }
            setFromSnapshot(true);
            setOnboarding(false);
            setBoot({ state: "ready" });
            return;
          }
          setBoot({ state: "error", message: error instanceof ApiFailure ? error.message : "Something went wrong." });
        },
      );
    },
    [saver, profileJob, linkJob],
  );

  useEffect(() => load(), [load]);

  // Installable app: the service worker lets the dashboard open without a connection. Production builds only.
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  // When the connection comes back, send what is waiting, then fetch fresh data.
  useEffect(() => {
    const back = (): void => {
      setOnline(true);
      void saver.retry().then(() => load(true));
    };
    const gone = (): void => setOnline(false);
    window.addEventListener("online", back);
    window.addEventListener("offline", gone);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", gone);
    };
  }, [saver, load]);

  // Keep a copy of what is on screen, so the dashboard can open next time with no connection.
  useEffect(() => {
    if (boot.state !== "ready" || !profile) return;
    const timer = setTimeout(() => saveSnapshot(profile, links), 500);
    return () => clearTimeout(timer);
  }, [boot.state, profile, links]);

  // The Preview tab only exists on narrow screens. On a wide screen the preview is always beside the editor.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const leavePreview = (): void => {
      if (wide.matches) setTab((current) => (current === "preview" ? "links" : current));
    };
    wide.addEventListener("change", leavePreview);
    return () => wide.removeEventListener("change", leavePreview);
  }, []);

  // ---- Deleting with undo. The server delete happens after the undo window closes. ----
  const commitDelete = useCallback(async (): Promise<void> => {
    const pending = pendingDelete.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDelete.current = null;
    setToast(null);
    try {
      await api.deleteLink(pending.link.id);
    } catch (error) {
      setLinks((current) => {
        const copy = [...current];
        copy.splice(Math.min(pending.index, copy.length), 0, pending.link);
        return copy;
      });
      setToast({ message: error instanceof ApiFailure ? `Could not delete: ${error.message}` : "Could not delete the link." });
    }
  }, []);

  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent): void => {
      if (saver.hasUnsaved()) event.preventDefault();
    };
    const hidden = (): void => {
      void saver.flush();
      const pending = pendingDelete.current;
      if (pending) {
        pendingDelete.current = null;
        void api.deleteLink(pending.link.id, true).catch(() => undefined);
      }
    };
    window.addEventListener("beforeunload", leaving);
    window.addEventListener("pagehide", hidden);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      window.removeEventListener("pagehide", hidden);
    };
  }, [saver]);

  function changeProfile(patch: ProfilePatch): void {
    setProfile((current) => (current ? { ...current, ...patch } : current));
    pendingProfile.current = { ...pendingProfile.current, ...patch };
    persistDrafts();
    saver.schedule("profile", profileJob);
  }

  function changeLink(id: string, patch: LinkPatch, immediate = false): void {
    setLinks((current) => current.map((link) => (link.id === id ? { ...link, ...patch } : link)));
    pendingLinks.current.set(id, { ...pendingLinks.current.get(id), ...patch });
    persistDrafts();
    saver.schedule(`link:${id}`, linkJob(id), immediate);
  }

  async function createLink(input: NewLink): Promise<void> {
    const created = await api.createLink(input);
    setLinks((current) => [...current, created]);
  }

  function moveLink(from: number, to: number, commit: boolean): void {
    if (from !== to) setLinks((current) => moveItem(current, from, to));
    if (!commit) return;
    saver.schedule(
      "order",
      async () => {
        await commitDelete();
        await api.reorder(linksRef.current.map((link) => link.id));
      },
      true,
    );
  }

  function deleteLink(id: string): void {
    void commitDelete();
    const index = linksRef.current.findIndex((link) => link.id === id);
    const link = linksRef.current[index];
    if (!link) return;
    saver.cancel(`link:${id}`);
    pendingLinks.current.delete(id);
    persistDrafts();
    setLinks((current) => current.filter((item) => item.id !== id));
    const timer = setTimeout(() => void commitDelete(), UNDO_MS);
    pendingDelete.current = { link, index, timer };
    setToast({
      message: `“${link.title}” was deleted.`,
      undo: () => {
        const pending = pendingDelete.current;
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingDelete.current = null;
        setLinks((current) => {
          const copy = [...current];
          copy.splice(Math.min(pending.index, copy.length), 0, pending.link);
          return copy;
        });
        setToast(null);
      },
    });
  }

  if (boot.state === "loading") {
    return (
      <div class="app" aria-busy="true">
        <div class="topbar"><span class="brand">Linkbeam</span></div>
        <main class="panel">
          <h1 class="sr-only">Loading your dashboard</h1>
          <div class="skeleton" style="height:48px" />
          <div class="skeleton" style="height:120px" />
          <div class="skeleton" style="height:120px" />
        </main>
      </div>
    );
  }

  if (boot.state === "error" || !profile) {
    return (
      <main class="auth-shell">
        <div class="card auth-card" role="alert">
          <h1>We could not load your dashboard</h1>
          <p>{boot.state === "error" ? boot.message : "Please try again."}</p>
          <button class="btn" type="button" onClick={() => load()}>Try again</button>
        </div>
      </main>
    );
  }

  if (onboarding) {
    return (
      <Onboarding
        profile={profile}
        onProfile={setProfile}
        onLink={(link) => setLinks((current) => [...current, link])}
        onFinish={() => {
          try {
            localStorage.setItem(SKIP_KEY, "1");
          } catch {
            // Private browsing can block storage. The setup then simply shows again on the next visit.
          }
          setOnboarding(false);
        }}
      />
    );
  }

  return (
    <div class="app">
      <header class="topbar">
        <h1 class="sr-only">Linkbeam dashboard</h1>
        <a class="brand" href="/dashboard">Linkbeam</a>
        <div class={`save-status${status.value === "error" && online ? " error" : ""}`} aria-live="polite">
          {status.value === "saving" && <>Saving…</>}
          {status.value === "saved" && <><Check size={16} aria-hidden="true" /> Saved</>}
          {status.value === "error" && !online && (
            <>
              <WifiOff size={16} aria-hidden="true" /> Offline. Saved on this device.
            </>
          )}
          {status.value === "error" && online && (
            <>
              <CircleAlert size={16} aria-hidden="true" /> Not saved.
              <button type="button" class="btn btn-quiet" onClick={() => void saver.retry()}>
                <RefreshCw size={14} aria-hidden="true" /> Try again
              </button>
            </>
          )}
        </div>
      </header>

      <div class="workspace">
        <nav class="tabs" aria-label="Dashboard sections">
          {TABS.map(({ id, label, Icon, mobileOnly }) => (
            <button key={id} type="button" class={mobileOnly ? "tab-preview" : undefined} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <main class={tab === "preview" ? "panel preview-intro" : "panel"} id="main">
          {tab === "preview" && (
            <>
              <h2>Preview</h2>
              <p class="muted">This is how visitors will see your page.</p>
            </>
          )}
          {(!online || fromSnapshot) && (
            <div class="notice" role="status" data-testid="offline-banner">
              <WifiOff size={16} aria-hidden="true" /> You are offline. You can keep editing your links and design, and your changes are kept on this device. Adding, deleting or reordering links, your photo and your username need a connection.
            </div>
          )}
          {profile.username === null && <div class="notice">Choose a username in Settings to get your page address.</div>}
          {tab === "links" && <LinksTab links={links} onCreate={createLink} onChange={changeLink} onMove={moveLink} onDelete={deleteLink} />}
          {tab === "design" && <DesignTab profile={profile} onChange={changeProfile} />}
          {tab === "share" && <ShareTab username={profile.username} onChooseUsername={() => setTab("settings")} />}
          {tab === "stats" && <StatsTab username={profile.username} />}
          {tab === "settings" && (
            <>
              <h2>Settings</h2>
              <ProfileFields profile={profile} onChange={changeProfile} />
              <SettingsTab profile={profile} onUsernameSaved={(updated) => setProfile((current) => (current ? { ...current, username: updated.username } : current))} />
            </>
          )}
        </main>

        <aside class={`preview-pane${tab === "preview" ? " mobile-visible" : ""}`} aria-label="Live preview">
                    <Preview profile={profile} links={links} />
        </aside>
      </div>

      {toast && <Toast message={toast.message} actionLabel={toast.undo ? "Undo" : undefined} onAction={toast.undo} onClose={() => setToast(null)} />}
    </div>
  );
}

function ProfileFields({ profile, onChange }: { profile: Profile; onChange: (patch: ProfilePatch) => void }) {
  return (
    <section class="card" aria-labelledby="profile-heading">
      <h3 id="profile-heading">Your profile</h3>
      <div class="field" style="margin-top:12px">
        <label for="display-name">Display name</label>
        <input id="display-name" class="input" value={profile.display_name} maxLength={60} autocomplete="name" onInput={(event) => onChange({ display_name: (event.target as HTMLInputElement).value })} />
      </div>
      <div class="field">
        <label for="bio">Bio</label>
        <textarea id="bio" class="input" value={profile.bio} maxLength={160} aria-describedby="bio-count" onInput={(event) => onChange({ bio: (event.target as HTMLTextAreaElement).value })} />
        <p class="counter" id="bio-count">{profile.bio.length} of 160</p>
      </div>
    </section>
  );
}
