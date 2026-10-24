import { BG_STYLES, BUTTON_SHAPES, FONT_PAIRS, PAGE_THEMES, THEMES, resolveAppearance, type BgStyle, type ButtonShape, type FontPair, type ThemeId } from "@linkbeam/shared";
import type { Profile, ProfilePatch } from "../lib/api";

interface Props {
  profile: Profile;
  onChange: (patch: ProfilePatch) => void;
}

const SHAPE_LABELS: Record<ButtonShape, string> = { pill: "Pill", rounded: "Rounded", square: "Square" };
const FONT_LABELS: Record<FontPair, string> = { friendly: "Friendly", clean: "Clean" };
const BG_LABELS: Record<BgStyle, string> = { solid: "Plain", gradient: "Soft gradient", pattern: "Dots" };

function Radio<T extends string>(props: { name: string; value: T; current: T; label: string; onPick: (value: T) => void; children?: preact.ComponentChildren }) {
  return (
    <label class="choice">
      <input type="radio" name={props.name} value={props.value} checked={props.current === props.value} onChange={() => props.onPick(props.value)} />
      <span class="box">
        {props.children}
        <span>{props.label}</span>
      </span>
    </label>
  );
}

export default function DesignTab({ profile, onChange }: Props) {
  const { warnings } = resolveAppearance(profile);
  const accentValue = profile.accent ?? PAGE_THEMES[profile.theme].button;

  return (
    <>
      <h2>Design</h2>

      <fieldset>
        <legend>Theme</legend>
        <div class="choices">
          {THEMES.map((id) => {
            const theme = PAGE_THEMES[id];
            return (
              <Radio<ThemeId> key={id} name="theme" value={id} current={profile.theme} label={theme.label} onPick={(value) => onChange({ theme: value })}>
                <span class="swatch" style={{ background: theme.bg, color: theme.text }} aria-hidden="true">
                  <i style={{ background: theme.button }} />
                </span>
              </Radio>
            );
          })}
        </div>
      </fieldset>

      <div class="field">
        <label for="accent-hex">Button colour</label>
        <div class="color-row">
          <input
            type="color"
            aria-label="Pick a button colour"
            value={accentValue.toLowerCase()}
            onInput={(event) => onChange({ accent: (event.target as HTMLInputElement).value.toUpperCase() })}
          />
          <input
            id="accent-hex"
            class="input"
            value={accentValue.toUpperCase()}
            maxLength={7}
            spellcheck={false}
            autocapitalize="off"
            aria-describedby="accent-help"
            onInput={(event) => {
              const value = (event.target as HTMLInputElement).value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(value)) onChange({ accent: value.toUpperCase() });
            }}
          />
          <button type="button" class="btn btn-quiet" disabled={profile.accent === null} onClick={() => onChange({ accent: null })}>
            Use theme colour
          </button>
        </div>
        <p class="hint" id="accent-help">Type a colour like #0B6B3A, or pick one.</p>
        <div role="status">
          {warnings.map((warning) => (
            <p class="notice error" key={warning} style="margin-top:8px">{warning}</p>
          ))}
        </div>
      </div>

      <fieldset>
        <legend>Button shape</legend>
        <div class="choices">
          {BUTTON_SHAPES.map((shape) => (
            <Radio<ButtonShape> key={shape} name="shape" value={shape} current={profile.button_shape} label={SHAPE_LABELS[shape]} onPick={(value) => onChange({ button_shape: value })}>
              <span style={{ display: "block", width: "80%", height: "20px", background: "var(--primary)", borderRadius: shape === "pill" ? "999px" : shape === "rounded" ? "8px" : "2px" }} aria-hidden="true" />
            </Radio>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Font</legend>
        <div class="choices">
          {FONT_PAIRS.map((pair) => (
            <Radio<FontPair> key={pair} name="font" value={pair} current={profile.font_pair} label={FONT_LABELS[pair]} onPick={(value) => onChange({ font_pair: value })}>
              <span style={{ fontFamily: pair === "friendly" ? "var(--font-heading)" : "var(--font-body)", fontWeight: 800, fontSize: "20px" }} aria-hidden="true">Aa</span>
            </Radio>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Background</legend>
        <div class="choices">
          {BG_STYLES.map((style) => (
            <Radio<BgStyle> key={style} name="background" value={style} current={profile.bg_style} label={BG_LABELS[style]} onPick={(value) => onChange({ bg_style: value })} />
          ))}
        </div>
      </fieldset>

      <label class="switch">
        <input type="checkbox" checked={profile.show_badge} onChange={(event) => onChange({ show_badge: (event.target as HTMLInputElement).checked })} />
        <span>Show "Made with Linkbeam" on my page</span>
      </label>
    </>
  );
}
