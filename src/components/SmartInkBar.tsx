/**
 * Floating Smart Ink toolbar — pen toggle, conversion mode, compact typography
 * controls and an expandable panel for the rest.
 */
import { useEffect, useRef, useState } from "react";
import {
  cssFamily,
  ensureFontLoaded,
  fontLabel,
  INK_FONTS,
  variantSupport,
} from "../smartink/fonts";
import type { InkEngineStatus } from "../smartink/engine";
import type { InkTextStyle, SmartInkSettings } from "../smartink/types";
import { usePhoneLayout } from "../platform";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconMore,
  IconPen,
} from "./icons";

const SIZES = [16, 20, 24, 32, 40, 56, 72];

function StyleToggle({
  label,
  title,
  active,
  disabled,
  onToggle,
  italic,
  strike,
}: {
  label: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
  italic?: boolean;
  strike?: boolean;
}) {
  return (
    <button
      type="button"
      className="ink-tool"
      title={disabled ? `${title} (not available for this font)` : title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
      style={{
        fontWeight: label === "B" ? 700 : 500,
        fontStyle: italic ? "italic" : undefined,
        textDecoration: strike ? "line-through" : label === "U" ? "underline" : undefined,
      }}
    >
      {label}
    </button>
  );
}

export default function SmartInkBar({
  settings,
  onChangeSettings,
  engineStatus,
  engineDetail,
  inkCount,
  canConvert,
  busy,
  error,
  onConvert,
  onApplyStyle,
  activeStyle,
}: {
  settings: SmartInkSettings;
  onChangeSettings: (p: Partial<SmartInkSettings>) => void;
  engineStatus: InkEngineStatus;
  engineDetail: string;
  inkCount: number;
  canConvert: boolean;
  busy: boolean;
  error: string;
  onConvert: () => void;
  onApplyStyle: (patch: Partial<InkTextStyle>) => void;
  activeStyle: InkTextStyle;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [aaOpen, setAaOpen] = useState(false);
  const phone = usePhoneLayout();
  const [presetName, setPresetName] = useState("");
  const barRef = useRef<HTMLDivElement>(null);
  const style = activeStyle;
  const support = variantSupport(style.fontFamily);

  useEffect(() => {
    void ensureFontLoaded(style.fontFamily);
  }, [style.fontFamily]);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (moreOpen && barRef.current && !barRef.current.contains(e.target as Node))
        setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [moreOpen]);

  useEffect(() => {
    if (!phone) setAaOpen(false);
  }, [phone]);

  const patch = (p: Partial<InkTextStyle>) => onApplyStyle(p);
  const closeSheets = () => {
    setAaOpen(false);
    setMoreOpen(false);
  };

  const lead = (
    <div className="ink-bar__lead" title="Smart Ink is on — draw with the pen tool">
      <IconPen className="ink-glyph" />
      <span className="ink-bar__name">Ink</span>
    </div>
  );
  const mode = (
    <div className="segments ink-mode" role="group" aria-label="Conversion mode">
      {(["auto", "preview", "manual"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={settings.mode === m}
          title={
            m === "auto"
              ? "Convert automatically when you pause writing"
              : m === "preview"
                ? "Show recognized text before converting"
                : "Convert selected ink with the button"
          }
          onClick={() => onChangeSettings({ mode: m })}
        >
          {m === "auto" ? "Auto" : m === "preview" ? "Preview" : "Manual"}
        </button>
      ))}
    </div>
  );
  const convert =
    settings.mode === "manual" ? (
      <button
        type="button"
        className="primary ink-convert"
        disabled={!canConvert || busy}
        onClick={onConvert}
        title="Convert selected handwriting to text (Ctrl+Shift+T)"
      >
        {busy ? "Reading…" : "Convert"}
      </button>
    ) : null;
  const font = (
    <select
      className="ink-select"
      aria-label="Font family"
      value={style.fontFamily}
      onChange={(e) => patch({ fontFamily: Number(e.target.value) })}
    >
      {INK_FONTS.map((f) => (
        <option key={f.label} value={f.variants.regular.code}>
          {f.label}
        </option>
      ))}
    </select>
  );
  const size = (
    <select
      className="ink-select ink-size"
      aria-label="Font size"
      value={SIZES.includes(style.fontSize) ? String(style.fontSize) : "custom"}
      onChange={(e) => patch({ fontSize: Number(e.target.value) })}
    >
      {!SIZES.includes(style.fontSize) && (
        <option value="custom">{Math.round(style.fontSize)}</option>
      )}
      {SIZES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
  const toggles = (
    <div className="ink-toggles" role="group" aria-label="Text style">
      <StyleToggle label="B" title="Bold" active={style.bold} disabled={!support.bold} onToggle={() => patch({ bold: !style.bold })} />
      <StyleToggle label="I" title="Italic" italic active={style.italic} disabled={!support.italic} onToggle={() => patch({ italic: !style.italic })} />
      <StyleToggle label="U" title="Underline" active={style.underline} onToggle={() => patch({ underline: !style.underline })} />
      <StyleToggle label="S" title="Strikethrough" strike active={style.strikethrough} onToggle={() => patch({ strikethrough: !style.strikethrough })} />
    </div>
  );
  const color = (
    <label className="ink-color" title="Text color">
      <input
        type="color"
        aria-label="Text color"
        value={style.color}
        onChange={(e) => patch({ color: e.target.value })}
      />
    </label>
  );
  const align = (
    <div className="segments ink-align" role="group" aria-label="Text alignment">
      {(["left", "center", "right"] as const).map((a) => {
        const Icon = a === "left" ? IconAlignLeft : a === "center" ? IconAlignCenter : IconAlignRight;
        return (
          <button
            key={a}
            type="button"
            aria-pressed={style.align === a}
            title={`Align ${a}`}
            onClick={() => patch({ align: a })}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
  const more = (
    <button
      type="button"
      className="ink-tool"
      aria-pressed={moreOpen}
      aria-label="More typography"
      title="More typography"
      onClick={() => {
        setMoreOpen((v) => !v);
        if (phone) setAaOpen(true);
      }}
    >
      <IconMore />
    </button>
  );
  const aa = (
    <button
      type="button"
      className="ink-tool ink-aa"
      aria-expanded={aaOpen}
      title="Text options"
      onClick={() => {
        setMoreOpen(false);
        setAaOpen((v) => !v);
      }}
    >
      Aa
    </button>
  );
  const status = (
    <div className="ink-bar__status" role="status">
      {error ? (
        <span className="ink-error" role="alert">{error}</span>
      ) : engineStatus === "downloading" ? (
        <span>Downloading model… {engineDetail}</span>
      ) : engineStatus === "initializing" ? (
        <span>Loading recognizer…</span>
      ) : engineStatus === "busy" || busy ? (
        <span>Reading handwriting…</span>
      ) : engineStatus === "error" ? (
        <span className="ink-error">Recognizer error — {engineDetail || "retry on next stroke"}</span>
      ) : settings.mode !== "manual" && inkCount > 0 ? (
        <span>{inkCount} stroke{inkCount === 1 ? "" : "s"} waiting</span>
      ) : (
        <span className="ink-ready">{engineStatus === "ready" ? "Ready" : "Write with the pen tool"}</span>
      )}
    </div>
  );
  const advanced = moreOpen && (
    <div className="ink-more">
      <label className="numeric-setting">
        <span>Preview — <span style={{ fontFamily: cssFamily(style.fontFamily) }}>Handwriting</span></span>
      </label>
      <label className="numeric-setting">
        Line height
        <input
          type="number"
          min="0.9"
          max="2.5"
          step="0.05"
          value={style.lineHeight}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) patch({ lineHeight: Math.min(2.5, Math.max(0.9, v)) });
          }}
        />
      </label>
      <label className="numeric-setting">
        Letter spacing
        <input
          type="number"
          min="0"
          max="0.4"
          step="0.02"
          value={style.letterSpacing}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) patch({ letterSpacing: Math.min(0.4, Math.max(0, v)) });
          }}
        />
      </label>
      <label className="numeric-setting">
        Font size
        <input
          type="number"
          min="6"
          max="160"
          value={style.fontSize}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) patch({ fontSize: Math.min(160, Math.max(6, v)) });
          }}
        />
      </label>
      <label className="numeric-setting">
        Highlight
        <span className="ink-highlight">
          <input
            type="color"
            aria-label="Highlight color"
            value={style.highlight ?? "#fff176"}
            onChange={(e) => patch({ highlight: e.target.value })}
          />
          <button
            type="button"
            aria-pressed={!style.highlight}
            onClick={() => patch({ highlight: null })}
          >
            Off
          </button>
        </span>
      </label>
      <div className="ink-presets">
        <span className="muted">Styles</span>
        {settings.presets.map((p) => (
          <button
            key={p.name}
            type="button"
            className="ink-preset"
            title={fontLabel(p.style.fontFamily)}
            onClick={() => onApplyStyle(p.style)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="ink-save-preset">
        <input
          type="text"
          placeholder="Preset name"
          value={presetName}
          maxLength={24}
          onChange={(e) => setPresetName(e.target.value)}
        />
        <button
          type="button"
          disabled={!presetName.trim()}
          onClick={() => {
            const name = presetName.trim();
            onChangeSettings({
              presets: [
                ...settings.presets.filter((p) => p.name !== name),
                { name, style: { ...style } },
              ],
            });
            setPresetName("");
          }}
        >
          Save style
        </button>
      </div>
      <button
        type="button"
        className="settings-link"
        onClick={() => onApplyStyle({
          fontFamily: 100, fontSize: 24, color: "#1e293b", align: "left",
          lineHeight: 1.25, bold: false, italic: false, underline: false,
          strikethrough: false, highlight: null, letterSpacing: 0,
        })}
      >
        Restore default style <span>↺</span>
      </button>
    </div>
  );

  return (
    <div className="ink-bar workspace-surface" ref={barRef} role="toolbar" aria-label="Smart Ink">
      {phone ? (
        <>
          <div className="ink-bar__row">
            {mode}
            {convert}
            {aa}
            {color}
            {more}
          </div>
          {status}
          {aaOpen && (
            <>
              <button
                type="button"
                className="sheet-backdrop"
                aria-label="Close text options"
                onClick={closeSheets}
              />
              <div className="ink-sheet" role="group" aria-label="Text options">
                <div className="sheet-grip" aria-hidden="true" />
                <div className="ink-sheet__row">
                  {font}
                  {size}
                  {toggles}
                  {align}
                </div>
                {advanced}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="ink-bar__row">
            {lead}
            {mode}
            {convert}
            {font}
            {size}
            {toggles}
            {color}
            {align}
            {more}
          </div>
          {status}
          {advanced}
        </>
      )}
    </div>
  );
}
