import type { ReactNode } from "react";
import type { SceneObject, Vec3 } from "../types/scene";
import { PRIMITIVE_PARAMS } from "../types/scene";
import { geometrySize } from "../geometry/measure";
import {
  indexObjects,
  matrixToTransform,
  worldMatrix,
} from "../geometry/transforms";
import { formatLength } from "../scene/units";
import { useSceneStore, useSelectedObject } from "../store/sceneStore";
import { useEditorStore, useSelectedIds } from "../store/editorStore";
import { NumberField } from "./NumberField";

const DEG = 180 / Math.PI;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function VectorInput({
  value,
  onChange,
  step = 0.1,
}: {
  value: Vec3;
  onChange: (v: Vec3) => void;
  step?: number;
}) {
  const axes = ["X", "Y", "Z"] as const;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {axes.map((axis, i) => (
        <NumberField
          key={axis}
          prefix={axis}
          step={step}
          value={value[i]}
          onCommit={(n) => {
            const next = [...value] as Vec3;
            next[i] = n;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

/** Numeric fields for whichever primitive is selected, built from its specs. */
function ShapeParams({ object }: { object: SceneObject }) {
  const setPrimitiveParam = useSceneStore((s) => s.setPrimitiveParam);
  if (object.geometry.kind !== "primitive") return null;

  const { primitive, params } = object.geometry;
  const specs = PRIMITIVE_PARAMS[primitive];

  return (
    <Field label={primitive}>
      <div className="space-y-1.5">
        {Object.entries(specs).map(([name, spec]) => (
          <div key={name} className="flex items-center gap-2">
            <span className="w-[86px] shrink-0 truncate text-[12px] text-stage-muted">
              {spec.label}
            </span>
            <div className="min-w-0 flex-1">
              <NumberField
                value={params[name] ?? spec.default}
                step={spec.step}
                min={spec.min}
                max={spec.max}
                title={`${spec.min} – ${spec.max}`}
                onCommit={(v) => setPrimitiveParam(object.id, name, v)}
              />
            </div>
          </div>
        ))}
      </div>
    </Field>
  );
}

/** Small text button for the batch actions below. */
function BatchButton({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md border border-stage-line bg-stage-field px-2 py-1.5 text-left text-[12px] transition-colors ${
        danger
          ? "text-stage-muted hover:border-stage-warn hover:text-stage-warn"
          : "text-stage-muted hover:border-stage-accent hover:text-stage-accent"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * What the panel shows when more than one object is selected.
 *
 * Per-object numeric fields make no sense here -- three objects have three
 * positions -- so this offers the operations that do apply to a set, and says
 * plainly what is not available yet rather than showing a gizmo that would
 * only move one of them.
 */
function MultiSelection({ ids }: { ids: string[] }) {
  const objects = useSceneStore((s) => s.objects);
  const setVisibleMany = useSceneStore((s) => s.setVisibleMany);
  const setLockedMany = useSceneStore((s) => s.setLockedMany);
  const duplicateObjects = useSceneStore((s) => s.duplicateObjects);
  const deleteObjects = useSceneStore((s) => s.deleteObjects);
  const groupSelection = useSceneStore((s) => s.groupSelection);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const chosen = objects.filter((o) => ids.includes(o.id));
  // "Any" rather than "all": one click should bring a mixed selection into
  // agreement, and the obvious reading of Hide on a half-hidden set is that
  // everything ends up hidden.
  const anyVisible = chosen.some((o) => o.visible);
  const anyUnlocked = chosen.some((o) => !o.locked);

  return (
    <div className="flex-1 divide-y divide-stage-line overflow-y-auto">
      <Field label={`${ids.length} objects selected`}>
        <div className="space-y-1.5">
          <BatchButton
            label={anyVisible ? "Hide all" : "Show all"}
            onClick={() => setVisibleMany(ids, !anyVisible)}
          />
          <BatchButton
            label={anyUnlocked ? "Lock all" : "Unlock all"}
            onClick={() => setLockedMany(ids, anyUnlocked)}
          />
          <BatchButton
            label="Group these"
            onClick={() => groupSelection()}
          />
          <BatchButton
            label="Duplicate all"
            onClick={() => duplicateObjects(ids)}
          />
          <BatchButton
            label="Delete all"
            danger
            onClick={() => deleteObjects(ids)}
          />
          <BatchButton label="Deselect" onClick={clearSelection} />
        </div>
      </Field>

      <div className="px-4 py-3 text-[12px] leading-relaxed text-stage-faint">
        The gizmo only appears for a single selection. To move these together,
        group them — the group's pivot lands at their centre.
      </div>
    </div>
  );
}

/**
 * The selected object's real-world dimensions.
 *
 * Measured in WORLD scale, not the object's own: a box inside a group scaled
 * to 0.5 is half a metre wide on screen, and reporting its local 1 m would be
 * useless for building to size.
 */
function SizeReadout({ object }: { object: SceneObject }) {
  const objects = useSceneStore((s) => s.objects);
  const unitSystem = useEditorStore((s) => s.unitSystem);

  const local = geometrySize(object.geometry);
  if (!local) return null;

  const byId = indexObjects(objects);
  const worldScale = matrixToTransform(worldMatrix(object.id, byId)).scale;

  return (
    <Field label="Size">
      <div className="font-mono text-[12px] leading-relaxed text-stage-ink">
        {local
          .map((v, i) => formatLength(Math.abs(v * worldScale[i]), unitSystem))
          .join("  ×  ")}
      </div>
    </Field>
  );
}

export function Inspector() {
  const object = useSelectedObject();
  const selectedIds = useSelectedIds();
  const setTransform = useSceneStore((s) => s.setTransform);
  const renameObject = useSceneStore((s) => s.renameObject);
  const setLocked = useSceneStore((s) => s.setLocked);
  const ungroupSelection = useSceneStore((s) => s.ungroupSelection);

  const multiple = selectedIds.length > 1;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-stage-line bg-stage-panel">
      <div className="px-4 pt-4 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint">
        Properties
      </div>

      {multiple && <MultiSelection ids={selectedIds} />}

      {!multiple && !object && (
        <p className="px-4 py-3 text-[12px] leading-relaxed text-stage-faint">
          Select an object to edit it.
        </p>
      )}

      {!multiple && object && (
        <div className="flex-1 divide-y divide-stage-line overflow-y-auto">
          <Field label="Name">
            <input
              value={object.name}
              onChange={(e) => renameObject(object.id, e.target.value)}
              className="w-full rounded-md border border-stage-line bg-stage-field px-2 py-1.5 text-[13px] text-stage-ink outline-none transition-colors focus:border-stage-accent focus:bg-stage-panel"
            />
          </Field>

          <Field label="Locked">
            <label className="flex cursor-default items-center gap-2 text-[12px] text-stage-muted">
              <input
                type="checkbox"
                checked={object.locked}
                onChange={(e) => setLocked(object.id, e.target.checked)}
                className="accent-stage-accent"
              />
              Ignore clicks in the viewport
            </label>
          </Field>

          <Field label="Position">
            <VectorInput
              value={object.transform.position}
              onChange={(position) => setTransform(object.id, { position })}
            />
          </Field>

          <Field label="Rotation°">
            <VectorInput
              step={1}
              value={
                object.transform.rotation.map((r) => r * DEG) as unknown as Vec3
              }
              onChange={(deg) =>
                setTransform(object.id, {
                  rotation: deg.map((d) => d / DEG) as unknown as Vec3,
                })
              }
            />
          </Field>

          <Field label="Scale">
            <VectorInput
              value={object.transform.scale}
              onChange={(scale) => setTransform(object.id, { scale })}
            />
          </Field>

          <ShapeParams object={object} />

          <SizeReadout object={object} />

          {object.geometry.kind === "group" && (
            <Field label="Group">
              <p className="mb-2 text-[12px] leading-relaxed text-stage-faint">
                A group has no shape of its own. Move it to move everything
                inside it.
              </p>
              <BatchButton
                label="Ungroup"
                onClick={() => ungroupSelection()}
              />
            </Field>
          )}
        </div>
      )}
    </aside>
  );
}
