import type { FaceMaterial, SceneObject } from "../types/scene";
import { DEFAULT_MATERIAL, slotLabels } from "../types/scene";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useTextureStore } from "../store/textureStore";
import { NumberField } from "./NumberField";
import { Field, PanelButton } from "./PanelKit";

const DEG = 180 / Math.PI;

/**
 * Smallest tiling magnitude. Zero would collapse the UV transform and smear a
 * single texel across the whole face, which looks like a broken texture rather
 * than like a value worth having.
 */
const MIN_TILING = 0.01;

/**
 * Per-face material controls for the selected object.
 *
 * The slot chips are the whole idea: Three's BoxGeometry already ships six
 * material groups, so per-face texturing needs no UV unwrapping -- it needs a
 * way to say which face you mean. Naming them and letting a hover light the
 * face up in the viewport is that way, and it works from any camera angle,
 * which clicking the face in the viewport does not when the face is pointing
 * away from you.
 *
 * Renders nothing for a group, which has no slots of its own.
 */
export function MaterialPanel({ object }: { object: SceneObject }) {
  const textures = useSceneStore((s) => s.textures);
  const setFaceMaterial = useSceneStore((s) => s.setFaceMaterial);
  const setMaterialMany = useSceneStore((s) => s.setMaterialMany);
  const entries = useTextureStore((s) => s.entries);

  const activeSlot = useEditorStore((s) => s.activeSlot);
  const setActiveSlot = useEditorStore((s) => s.setActiveSlot);
  const setHighlightedSlot = useEditorStore((s) => s.setHighlightedSlot);

  const labels = slotLabels(object.geometry);
  if (labels.length === 0) return null;

  // Clamped rather than reset: keeping the index lets you move between two
  // boxes and stay on Top, and only a geometry with fewer slots pulls it back.
  const slot = Math.min(activeSlot, labels.length - 1);
  const face: FaceMaterial = object.materials[slot] ?? DEFAULT_MATERIAL;

  const patch = (change: Partial<FaceMaterial>) =>
    setFaceMaterial(object.id, slot, change);

  const flippedX = face.tiling[0] < 0;
  const flippedY = face.tiling[1] < 0;

  /** Rewrites one tiling axis, keeping the flip it already had. */
  const setTiling = (axis: 0 | 1, magnitude: number) => {
    const size = Math.max(MIN_TILING, Math.abs(magnitude));
    const signed = (axis === 0 ? flippedX : flippedY) ? -size : size;
    const tiling: [number, number] = [...face.tiling];
    tiling[axis] = signed;
    patch({ tiling });
  };

  const flip = (axis: 0 | 1) => {
    const tiling: [number, number] = [...face.tiling];
    tiling[axis] = -tiling[axis];
    patch({ tiling });
  };

  return (
    <>
      <Field label="Material">
        {/* One chip per slot. Hover lights the face in the viewport, which is
            how you confirm "Back" means the face you think it does. */}
        <div
          className="mb-2.5 flex flex-wrap gap-1"
          onMouseLeave={() => setHighlightedSlot(null)}
        >
          {labels.map((label, i) => {
            const assigned = object.materials[i]?.textureId;
            return (
              <button
                key={label}
                onClick={() => setActiveSlot(i)}
                onMouseEnter={() =>
                  setHighlightedSlot({ objectId: object.id, slot: i })
                }
                title={
                  assigned
                    ? `${label} — ${
                        textures.find((t) => t.id === assigned)?.name ??
                        "texture"
                      }`
                    : `${label} — flat colour`
                }
                className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                  i === slot
                    ? "border-stage-accent bg-stage-accent-soft text-stage-accent"
                    : "border-stage-line bg-stage-field text-stage-muted hover:border-stage-line-strong hover:text-stage-ink"
                }`}
              >
                {label}
                {/* A dot marks a slot carrying a texture, so a half-textured
                    object says so without clicking through every face. */}
                {assigned && (
                  <span className="ml-1 align-middle text-[9px] text-stage-accent">
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <select
          value={face.textureId ?? ""}
          onChange={(e) => patch({ textureId: e.target.value || null })}
          className="mb-2 w-full rounded-md border border-stage-line bg-stage-field px-2 py-1.5 text-[12px] text-stage-ink outline-none transition-colors focus:border-stage-accent focus:bg-stage-panel"
        >
          <option value="">No texture — flat colour</option>
          {textures.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {entries[t.id]?.status === "missing" ? "  (missing)" : ""}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="color"
            value={face.color}
            onChange={(e) => patch({ color: e.target.value })}
            title="Multiplies the texture when there is one, so this doubles as a tint"
            className="h-7 w-10 shrink-0 cursor-default rounded border border-stage-line bg-stage-field"
          />
          <span className="truncate font-mono text-[11px] text-stage-muted">
            {face.color}
          </span>
        </div>
      </Field>

      <Field label="Tiling">
        <div className="mb-1.5 flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            {/* The field carries magnitude and the toggles carry direction. A
                signed value in the box reads as a typo rather than as a flip,
                and this way the two controls cannot disagree. */}
            <NumberField
              prefix="X"
              step={0.25}
              min={MIN_TILING}
              value={Math.abs(face.tiling[0])}
              onCommit={(v) => setTiling(0, v)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <NumberField
              prefix="Y"
              step={0.25}
              min={MIN_TILING}
              value={Math.abs(face.tiling[1])}
              onCommit={(v) => setTiling(1, v)}
            />
          </div>
        </div>

        <div className="flex gap-1.5">
          <FlipButton label="Flip X" on={flippedX} onClick={() => flip(0)} />
          <FlipButton label="Flip Y" on={flippedY} onClick={() => flip(1)} />
        </div>
      </Field>

      <Field label="Offset">
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <NumberField
              prefix="X"
              step={0.05}
              value={face.offset[0]}
              onCommit={(v) => patch({ offset: [v, face.offset[1]] })}
            />
          </div>
          <div className="min-w-0 flex-1">
            <NumberField
              prefix="Y"
              step={0.05}
              value={face.offset[1]}
              onCommit={(v) => patch({ offset: [face.offset[0], v] })}
            />
          </div>
        </div>
      </Field>

      <Field label="Rotation°">
        <NumberField
          step={15}
          value={face.rotation * DEG}
          title="Rotates about the middle of the face"
          onCommit={(deg) => patch({ rotation: deg / DEG })}
        />
      </Field>

      <Field label={`${labels[slot]} options`}>
        <label className="mb-2 flex cursor-default items-center gap-2 text-[12px] text-stage-muted">
          <input
            type="checkbox"
            checked={face.doubleSided}
            onChange={(e) => patch({ doubleSided: e.target.checked })}
            className="accent-stage-accent"
          />
          Draw both sides
        </label>

        <PanelButton
          label="Copy this face to all faces"
          title="Applies every setting above to the object's other slots"
          disabled={labels.length === 1}
          onClick={() => setMaterialMany([object.id], face)}
        />
      </Field>
    </>
  );
}

/** A toggle that reads as pressed when the axis is mirrored. */
function FlipButton({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
        on
          ? "border-stage-accent bg-stage-accent-soft text-stage-accent"
          : "border-stage-line bg-stage-field text-stage-muted hover:border-stage-line-strong hover:text-stage-ink"
      }`}
    >
      {label}
    </button>
  );
}
