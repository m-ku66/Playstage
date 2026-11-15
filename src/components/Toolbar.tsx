import type { PrimitiveKind } from "../types/scene";
import type { TransformMode } from "../store/editorStore";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useDocumentStore } from "../store/documentStore";
import { useCanRedo, useCanUndo } from "../store/historyStore";
import { newScene, openScene, saveScene } from "../io/documentActions";

const PRIMITIVES: { kind: PrimitiveKind; label: string }[] = [
  { kind: "box", label: "Box" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "sphere", label: "Sphere" },
  { kind: "cone", label: "Cone" },
  { kind: "plane", label: "Plane" },
];

const MODES: { mode: TransformMode; label: string; hint: string }[] = [
  { mode: "translate", label: "Move", hint: "W" },
  { mode: "rotate", label: "Rotate", hint: "E" },
  { mode: "scale", label: "Scale", hint: "R" },
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

export function Toolbar() {
  const addPrimitive = useSceneStore((s) => s.addPrimitive);
  const addGroup = useSceneStore((s) => s.addGroup);
  const sceneName = useSceneStore((s) => s.sceneName);
  const dirty = useSceneStore((s) => s.dirty);
  const count = useSceneStore((s) => s.objects.length);
  const filePath = useDocumentStore((s) => s.filePath);
  const busy = useDocumentStore((s) => s.busy);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);

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

      {/* add primitives */}
      <div className="flex items-center gap-0.5">
        {PRIMITIVES.map((p) => (
          <button
            key={p.kind}
            onClick={() => addPrimitive(p.kind)}
            className="rounded-md px-2.5 py-1.5 text-[13px] text-stage-muted transition-colors hover:bg-stage-accent-soft hover:text-stage-accent"
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => addGroup()}
          title="Add an empty group, then drag objects onto it in the outliner"
          className="rounded-md px-2.5 py-1.5 text-[13px] text-stage-muted transition-colors hover:bg-stage-accent-soft hover:text-stage-accent"
        >
          Group
        </button>
      </div>

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
      <button
        onClick={toggleSnap}
        title="Toggle snapping (X)"
        className={`rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${
          snapEnabled
            ? "bg-stage-accent-soft text-stage-accent"
            : "text-stage-faint hover:text-stage-muted"
        }`}
      >
        Snap
      </button>

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

      <div className="ml-auto font-mono text-[11px] text-stage-faint">
        {count} object{count === 1 ? "" : "s"}
      </div>
    </header>
  );
}
