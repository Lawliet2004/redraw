import { useEffect, useState } from "react";
import { newElementWith } from "@excalidraw/excalidraw";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { IconChevronDown, IconChevronLeft } from "./icons";

type Style = Pick<
  ExcalidrawElement,
  | "strokeWidth"
  | "strokeColor"
  | "backgroundColor"
  | "opacity"
  | "roughness"
  | "strokeStyle"
  | "fillStyle"
>;

export default function PropertiesPanel({
  api,
  onHide,
  onAdvanced,
}: {
  api: ExcalidrawImperativeAPI;
  onHide: () => void;
  onAdvanced: () => void;
}) {
  const [, refresh] = useState(0);
  useEffect(() => {
    let signature = "";
    return api.onChange((elements, state) => {
      const selected = elements.filter((el) => state.selectedElementIds[el.id]);
      const next = JSON.stringify([
        selected.map((el) => [el.id, el.version]),
        state.activeTool.type,
        state.currentItemStrokeWidth,
        state.currentItemStrokeColor,
        state.currentItemBackgroundColor,
        state.currentItemOpacity,
        state.currentItemRoughness,
        state.currentItemStrokeStyle,
        state.currentItemFillStyle,
      ]);
      if (next !== signature) {
        signature = next;
        refresh((n) => n + 1);
      }
    });
  }, [api]);
  const state = api.getAppState();
  const selected = api
    .getSceneElements()
    .filter((el) => state.selectedElementIds[el.id] && !el.isDeleted);
  const first = selected[0];
  const values: Style = first || {
    strokeWidth: state.currentItemStrokeWidth,
    strokeColor: state.currentItemStrokeColor,
    backgroundColor: state.currentItemBackgroundColor,
    opacity: state.currentItemOpacity,
    roughness: state.currentItemRoughness,
    strokeStyle: state.currentItemStrokeStyle,
    fillStyle: state.currentItemFillStyle,
  };
  function update(patch: Partial<Style>) {
    const appPatch: Partial<AppState> = {};
    const mapping = {
      strokeWidth: "currentItemStrokeWidth",
      strokeColor: "currentItemStrokeColor",
      backgroundColor: "currentItemBackgroundColor",
      opacity: "currentItemOpacity",
      roughness: "currentItemRoughness",
      strokeStyle: "currentItemStrokeStyle",
      fillStyle: "currentItemFillStyle",
    } as const;
    for (const key of Object.keys(patch) as (keyof Style)[])
      Object.assign(appPatch, { [mapping[key]]: patch[key] });
    api.updateScene({
      appState: appPatch as AppState,
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((el) =>
          state.selectedElementIds[el.id] ? newElementWith(el, patch) : el,
        ),
      captureUpdate: "IMMEDIATELY",
    });
  }
  const drawing =
    state.activeTool.type !== "selection" && state.activeTool.type !== "hand";
  return (
    <section
      className="properties-panel workspace-surface"
      aria-label="Properties"
    >
      <header className="panel-heading">
        <h2>Properties</h2>
        <button
          className="icon-button"
          aria-label="Hide properties"
          onClick={onHide}
        >
          <IconChevronLeft />
        </button>
      </header>
      <p className="selection-caption">
        {selected.length
          ? `${selected.length} selected · ${selected.length === 1 ? first.type : "mixed objects"}`
          : drawing
            ? `New ${state.activeTool.type}`
            : "Style for your next shape"}
      </p>
      <details open>
        <summary>
          <IconChevronDown className="props-chevron" />
          Appearance
        </summary>
        <div className="color-fields">
          <label>
            Stroke
            <input
              type="color"
              value={
                /^#[\da-f]{6}$/i.test(values.strokeColor)
                  ? values.strokeColor
                  : "#1e1e1e"
              }
              onChange={(e) => update({ strokeColor: e.target.value })}
            />
          </label>
          <label>
            Fill
            <input
              type="color"
              value={
                /^#[\da-f]{6}$/i.test(values.backgroundColor)
                  ? values.backgroundColor
                  : "#ffffff"
              }
              onChange={(e) => update({ backgroundColor: e.target.value })}
            />
          </label>
          <button
            className="no-fill"
            aria-pressed={values.backgroundColor === "transparent"}
            onClick={() => update({ backgroundColor: "transparent" })}
          >
            No fill
          </button>
        </div>
        <label className="numeric-setting">
          Stroke width{" "}
          <input
            aria-label="Stroke width"
            type="number"
            min="0.5"
            max="12"
            step="0.5"
            value={values.strokeWidth}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isFinite(n) && n >= 0.5 && n <= 12)
                update({ strokeWidth: n });
            }}
          />
        </label>
        <div className="segments" role="group" aria-label="Stroke presets">
          {[
            { value: 0.5, label: "Thin" },
            { value: 1, label: "Medium" },
            { value: 2, label: "Thick" },
          ].map((p) => (
            <button
              key={p.value}
              aria-pressed={values.strokeWidth === p.value}
              onClick={() => update({ strokeWidth: p.value })}
            >
              <span className="stroke-sample" style={{ height: p.value }} />
              {p.label}
            </button>
          ))}
        </div>
        <label className="numeric-setting">
          Style
          <select
            value={values.strokeStyle}
            onChange={(e) =>
              update({ strokeStyle: e.target.value as Style["strokeStyle"] })
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
        <label className="numeric-setting">
          Fill style
          <select
            value={values.fillStyle}
            onChange={(e) =>
              update({ fillStyle: e.target.value as Style["fillStyle"] })
            }
          >
            <option value="hachure">Hachure</option>
            <option value="solid">Solid</option>
            <option value="cross-hatch">Cross hatch</option>
          </select>
        </label>
        <label className="numeric-setting">
          Drawing style
          <select
            value={values.roughness}
            onChange={(e) => update({ roughness: Number(e.target.value) })}
          >
            <option value={0}>Clean</option>
            <option value={1}>Sketch</option>
            <option value={2}>Rough</option>
          </select>
        </label>
        <label className="opacity-setting">
          Opacity <output>{values.opacity}%</output>
          <input
            aria-label="Opacity"
            type="range"
            min="0"
            max="100"
            step="5"
            value={values.opacity}
            onChange={(e) => update({ opacity: Number(e.target.value) })}
          />
        </label>
      </details>
      <details>
        <summary>
          <IconChevronDown className="props-chevron" />
          Geometry & arrange
        </summary>
        {selected.length === 1 && (
          <p className="muted">
            {Math.round(first.width)} × {Math.round(first.height)} canvas units
          </p>
        )}
        <p className="muted">
          Use the canvas handles to resize. Advanced controls include
          arrowheads, text, alignment, and layer ordering.
        </p>
        <button className="settings-link" onClick={onAdvanced}>
          Advanced properties <span>→</span>
        </button>
      </details>
      <button
        className="settings-link"
        onClick={() => api.toggleSidebar({ name: "library", tab: "library" })}
      >
        Shape library <span>→</span>
      </button>
    </section>
  );
}
