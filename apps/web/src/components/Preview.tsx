import { Link as LinkIcon, Coffee, Mail, MapPin, MessageCircle, Phone } from "lucide-preact";
import type { LinkKind } from "@linkbeam/shared";
import { isLiveAt, resolveAppearance } from "@linkbeam/shared";
import type { LinkItem, Profile } from "../lib/api";

const ICONS: Record<LinkKind, typeof LinkIcon> = {
  url: LinkIcon,
  whatsapp: MessageCircle,
  coffee: Coffee,
  call: Phone,
  email: Mail,
  map: MapPin,
};

interface Props {
  profile: Profile;
  links: LinkItem[];
}

/** What visitors will see. It is a picture of the page, so it is hidden from screen readers and cannot be clicked. */
export default function Preview({ profile, links }: Props) {
  const { vars } = resolveAppearance(profile);
  // Same rule as the public page, including start and end times.
  const now = Math.floor(Date.now() / 1000);
  const shown = links.filter((link) => isLiveAt(link, now));
  const name = profile.display_name || (profile.username ? `@${profile.username}` : "Your name");
  const initial = (profile.display_name || profile.username || "?").slice(0, 1).toUpperCase();

  return (
    <div>
      <div class="phone" style={vars} aria-hidden="true" inert>
        <div class="phone-screen">
          {profile.avatar_url ? (
            <img class="p-avatar" src={profile.avatar_url} alt="" width="88" height="88" />
          ) : (
            <div class="p-avatar">{initial}</div>
          )}
          <div class="p-name">{name}</div>
          {profile.bio && <p class="p-bio">{profile.bio}</p>}
          <div class="p-links">
            {shown.map((link) => {
              const Icon = ICONS[link.kind];
              return (
                <div class="p-btn" key={link.id}>
                  <Icon size={18} aria-hidden="true" /> {link.title}
                </div>
              );
            })}
            {shown.length === 0 && <p class="p-empty">Your links will appear here.</p>}
          </div>
          {profile.show_badge && <p class="p-badge">Made with Linkbeam</p>}
        </div>
      </div>
      <p class="preview-caption">Live preview. This is how your page will look.</p>
    </div>
  );
}
