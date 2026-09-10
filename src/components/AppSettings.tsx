import { useState } from "react";
import Dialog from "./Dialog";
import { parsePaper, type Paper } from "../paper";
import type { Preferences } from "../preferences";

export function Segments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting-field">
      <span>{label}</span>
      <div className="segments" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            key={o.value}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
}) {
  return (
    <label className="switch-row">
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export default function AppSettings({
  preferences,
  paper,
  onSave,
  onClose,
  onAiSettings,
}: {
  preferences: Preferences;
  paper: Paper;
  onSave: (p: Preferences, paper: Paper) => Promise<void>;
  onClose: () => void;
  onAiSettings: () => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [sheet, setSheet] = useState(paper);
  const [useDefault, setUseDefault] = useState(false);
  const [section, setSection] = useState("Workspace");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title="Settings" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave(
              {
                ...draft,
                defaultPaper: useDefault ? sheet : draft.defaultPaper,
              },
              sheet,
            );
            onClose();
          } catch {
            setError("Couldn't save settings. Please try again.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <nav className="settings-tabs" aria-label="Settings sections">
          {["Workspace", "Canvas", "AI"].map((s) => (
            <button
              type="button"
              key={s}
              aria-pressed={section === s}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        {section === "Workspace" && (
          <>
            <Segments
              label="Theme"
              value={draft.appTheme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(appTheme) => setDraft({ ...draft, appTheme })}
            />
            <Segments
              label="Accent"
              value={draft.palette}
              options={[
                { value: "neutral", label: "Graphite" },
                { value: "indigo", label: "Indigo" },
                { value: "forest", label: "Forest" },
              ]}
              onChange={(palette) => setDraft({ ...draft, palette })}
            />

            <Segments
              label="Tab layout"
              value={draft.tabLayout}
              options={[
                { value: "horizontal", label: "Horizontal" },
                { value: "vertical", label: "Vertical" },
              ]}
              onChange={(tabLayout) => setDraft({ ...draft, tabLayout })}
            />
            <Segments
              label="Interface density"
              value={draft.density}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
              ]}
              onChange={(density) => setDraft({ ...draft, density })}
            />
            <Switch
              label="Show properties"
              description="Toggle anytime with Ctrl+Shift+P."
              checked={draft.propertiesVisible}
              onChange={(propertiesVisible) =>
                setDraft({ ...draft, propertiesVisible })
              }
            />
            <p className="muted">
              Quick search: Ctrl+K. Focus: Ctrl+Shift+F. Escape restores the
              workspace.
            </p>
          </>
        )}
        {section === "Canvas" && (
          <>
            <p className="muted">
              Paper for this page. Drawing colors stay as you chose them.
            </p>
            <label className="setting-field">
              Paper color
              <input
                aria-label="Paper color"
                type="color"
                value={sheet.color}
                onChange={(e) => setSheet({ ...sheet, color: e.target.value })}
              />
            </label>
            <div className="paper-swatches">
              {[
                "#ffffff",
                "#fff8e7",
                "#eaf2ef",
                "#eef2ff",
                "#20252b",
                "#143b31",
              ].map((color) => (
                <button
                  type="button"
                  key={color}
                  aria-label={`Paper ${color}`}
                  style={{ background: color }}
                  aria-pressed={sheet.color === color}
                  onClick={() => setSheet({ ...sheet, color })}
                />
              ))}
            </div>
            <Segments
              label="Paper pattern"
              value={sheet.pattern}
              options={[
                { value: "plain", label: "Plain" },
                { value: "dots", label: "Dots" },
                { value: "grid", label: "Grid" },
                { value: "ruled", label: "Ruled" },
              ]}
              onChange={(pattern) => setSheet({ ...sheet, pattern })}
            />
            <label className="setting-field">
              Pattern spacing · {sheet.spacing}
              <input
                aria-label="Pattern spacing"
                type="range"
                min="12"
                max="80"
                value={sheet.spacing}
                onChange={(e) =>
                  setSheet(
                    parsePaper({ ...sheet, spacing: Number(e.target.value) }),
                  )
                }
              />
            </label>
            <Switch
              label="Use this paper for new pages"
              checked={useDefault}
              onChange={setUseDefault}
            />
          </>
        )}
        {section === "AI" && (
          <>
            <Segments
              label="Inline AI"
              value={draft.aiMode}
              options={[
                { value: "off", label: "Off" },
                { value: "assist", label: "Assist" },
                { value: "auto", label: "Auto-answer" },
              ]}
              onChange={(aiMode) => setDraft({ ...draft, aiMode })}
            />
            <p className="muted">
              Assist previews an answer beside selected writing after a pause.
              Auto-answer inserts it. Simple math runs on this device; other
              requests send selected content to your connected subscription.
              Select a question or handwriting to limit the context.
            </p>
            <button
              type="button"
              className="settings-link"
              onClick={onAiSettings}
            >
              ChatGPT and Grok subscriptions <span>→</span>
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
