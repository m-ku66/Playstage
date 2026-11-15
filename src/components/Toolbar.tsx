import type { TransformMode } from "../store/editorStore";
import type { UnitSystem } from "../scene/units";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useDocumentStore } from "../store/documentStore";
import { useCameraStore } from "../store/cameraStore";
import { useCanRedo, useCanUndo } from "../store/historyStore";
import { newScene, openScene, saveScene } from "../io/documentActions";
import { AddMenu } from "./AddMenu";

const MODES: { mode: TransformMode; label: string; hint: string }[] = [
  { mode: "translate", label: "Move", hint: "W" },
  { mode: "rotate", label: "Rotate", hint: "E" },
  { mode: "scale", label: "Scale", hint: "R" },
];

const UNIT_OPTIONS: { system: UnitSystem; label: string; hint: string }[] = [
  { system: "metric", label: "m", hint: "Metres and centimetres" },
  { system: "imperial", label: "ft", hint: "Feet and inches" },
];

function Divider() {
  return <div className="h-4 w-px bg-stage-line" />;
}

function HistoryButton({
  label,
  glyph,
  enabled,
  onClick,
}: {
  label: string;
  glyph: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={label}
      aria-label={label}
      className={`rounded-md px-2 py-1.5 text-[13px] leading-none transition-colors ${
        enabled
          ? "text-stage-muted hover:bg-stage-field hover:text-stage-ink"
          : "cursor-default text-stage-line-strong"
      }`}
    >
      {glyph}
    </button>
  );
}

/** Text button for the document actions. Disabled while an IO operation is in
 *  flight, so a slow write to a synced folder cannot be stacked up. */
function FileButton({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={`${label} (${hint})`}
      className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
        disabled
          ? "cursor-default text-stage-line-strong"
          : "text-stage-muted hover:bg-stage-field hover:text-stage-ink"
      }`}
    >
      {label}
    </button>
  );
}

/** Momentary button inside a segmented cluster — it acts, it is never "on". */
function ViewButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-md px-2 py-1 text-[12px] text-stage-muted transition-colors hover:bg-stage-panel hover:text-stage-ink"
    >
      {label}
    </button>
  );
}

/** Small on/off button, styled like Snap. */
function ToggleButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${
        active
          ? "bg-stage-accent-soft text-stage-accent"
          : "text-stage-faint hover:text-stage-muted"
      }`}
    >
      {label}
    </button>
  );
}

export function Toolbar() {
  const sceneName = useSceneStore((s) => s.sceneName);
  const dirty = useSceneStore((s) => s.dirty);
  const count = useSceneStore((s) => s.objects.length);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);

  const filePath = useDocumentStore((s) => s.filePath);
  const busy = useDocumentStore((s) => s.busy);

  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const transformMode = useEditorStore((s) => s.transformMode);
  const setTransformMode = useEditorStore((s) => s.setTransformMode);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const translateSnap = useEditorStore((s) => s.translateSnap);
  const setTranslateSnap = useEditorStore((s) => s.setTranslateSnap);
  const rotateSnapDeg = useEditorStore((s) => s.rotateSnapDeg);
  const setRotateSnapDeg = useEditorStore((s) => s.setRotateSnapDeg);
  const unitSystem = useEditorStore((s) => s.unitSystem);
  const setUnitSystem = useEditorStore((s) => s.setUnitSystem);
  const showGroundRuler = useEditorStore((s) => s.showGroundRuler);
  const toggleGroundRuler = useEditorStore((s) => s.toggleGroundRuler);
  const showEdgeRuler = useEditorStore((s) => s.showEdgeRuler);
  const toggleEdgeRuler = useEditorStore((s) => s.toggleEdgeRuler);

  const requestView = useCameraStore((s) => s.requestView);
  const flipView = useCameraStore((s) => s.flipView);
  const orthographic = useCameraStore((s) => s.orthographic);
  const toggleOrthographic = useCameraStore((s) => s.toggleOrthographic);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stage-line bg-stage-panel px-5">
      <span className="text-[13px] font-semibold tracking-tight text-stage-ink">
        Playstage
      </span>

      <Divider />

      {/* document actions */}
      <div className="flex items-center gap-0.5">
        <FileButton
          label="New"
          hint="Ctrl+N"
          disabled={busy}
          onClick={() => void newScene()}
        />
        <FileButton
          label="Open"
          hint="Ctrl+O"
          disabled={busy}
          onClick={() => void openScene()}
        />
        <FileButton
          label="Save"
          hint="Ctrl+S"
          disabled={busy}
          onClick={() => void saveScene()}
        />
      </div>

      <Divider />

      <span
        className="flex items-center gap-1.5 text-[13px] text-stage-muted"
        title={filePath ?? "Not saved yet"}
      >
        {sceneName}
        {dirty && (
          <span
            title="Unsaved changes"
            className="inline-block h-1.5 w-1.5 rounded-full bg-stage-warn"
          />
        )}
      </span>

      <Divider />

      {/* history */}
      <div className="flex items-center gap-0.5">
        <HistoryButton
          label="Undo (Ctrl+Z)"
          glyph="↶"
          enabled={canUndo}
          onClick={undo}
        />
        <HistoryButton
          label="Redo (Ctrl+Shift+Z)"
          glyph="↷"
          enabled={canRedo}
          onClick={redo}
        />
      </div>

      <Divider />

      <AddMenu />

      <Divider />

      {/* gizmo mode */}
      <div className="flex items-center gap-0.5 rounded-lg bg-stage-field p-0.5">
        {MODES.map((m) => {
          const active = transformMode === m.mode;
          return (
            <button
              key={m.mode}
              onClick={() => setTransformMode(m.mode)}
              title={`${m.label} (${m.hint})`}
              className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                active
                  ? "bg-stage-panel text-stage-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "text-stage-muted hover:text-stage-ink"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* snapping */}
      <ToggleButton
        label="Snap"
        title="Toggle snapping (X)"
        active={snapEnabled}
        onClick={toggleSnap}
      />

      {snapEnabled && (
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1 rounded-md border border-stage-line bg-stage-field px-1.5 py-1"
            title="Translate step, in world units"
          >
            <span className="font-mono text-[10px] text-stage-faint">u</span>
            <input
              type="number"
              step={0.05}
              min={0.01}
              value={translateSnap}
              onChange={(e) =>
                setTranslateSnap(Math.max(0.01, Number(e.target.value)))
              }
              className="w-12 bg-transparent font-mono text-[11px] text-stage-ink outline-none"
            />
          </label>
          <label
            className="flex items-center gap-1 rounded-md border border-stage-line bg-stage-field px-1.5 py-1"
            title="Rotate step, in degrees"
          >
            <span className="font-mono text-[10px] text-stage-faint">°</span>
            <input
              type="number"
              step={5}
              min={1}
              value={rotateSnapDeg}
              onChange={(e) =>
                setRotateSnapDeg(Math.max(1, Number(e.target.value)))
              }
              className="w-12 bg-transparent font-mono text-[11px] text-stage-ink outline-none"
            />
          </label>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* camera views */}
        <div className="flex items-center gap-0.5 rounded-lg bg-stage-field p-0.5">
          <ViewButton
            label="Front"
            title="Front view (1) — Ctrl+1 for back"
            onClick={() => requestView("front")}
          />
          <ViewButton
            label="Side"
            title="Right side view (3) — Ctrl+3 for left"
            onClick={() => requestView("right")}
          />
          <ViewButton
            label="Top"
            title="Top view (7) — Ctrl+7 for bottom"
            onClick={() => requestView("top")}
          />
          <ViewButton
            label="⇄"
            title="Flip to the opposite side (9)"
            onClick={flipView}
          />
        </div>

        <ToggleButton
          label="Ortho"
          title="Orthographic projection (5) — no perspective convergence, so an axis view is a true elevation and the edge rulers are exact everywhere"
          active={orthographic}
          onClick={toggleOrthographic}
        />

        {/* units */}
        <div className="flex items-center gap-0.5 rounded-lg bg-stage-field p-0.5">
          {UNIT_OPTIONS.map((u) => {
            const active = unitSystem === u.system;
            return (
              <button
                key={u.system}
                onClick={() => setUnitSystem(u.system)}
                title={u.hint}
                className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
                  active
                    ? "bg-stage-panel text-stage-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                    : "text-stage-muted hover:text-stage-ink"
                }`}
              >
                {u.label}
              </button>
            );
          })}
        </div>

        {/* rulers, toggled independently */}
        <ToggleButton
          label="Ground"
          title="Numbered ticks on the ground plane — correct from any camera angle"
          active={showGroundRuler}
          onClick={toggleGroundRuler}
        />
        <ToggleButton
          label="Edges"
          title="Ruler strips on the viewport edges — exact only at the camera's focus depth, unless the view is orthographic"
          active={showEdgeRuler}
          onClick={toggleEdgeRuler}
        />

        <span className="font-mono text-[11px] text-stage-faint">
          {count} object{count === 1 ? "" : "s"}
        </span>
      </div>
    </header>
  );
}
