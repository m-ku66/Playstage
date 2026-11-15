import type { ReactNode } from "react";
import type { SceneObject, Vec3 } from "../types/scene";
import { PRIMITIVE_PARAMS } from "../types/scene";
import { useSceneStore, useSelectedObject } from "../store/sceneStore";
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

export function Inspector() {
  const object = useSelectedObject();
  const setTransform = useSceneStore((s) => s.setTransform);
  const renameObject = useSceneStore((s) => s.renameObject);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-stage-line bg-stage-panel">
      <div className="px-4 pt-4 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint">
        Properties
      </div>

      {!object && (
        <p className="px-4 py-3 text-[12px] leading-relaxed text-stage-faint">
          Select an object to edit it.
        </p>
      )}

      {object && (
        <div className="flex-1 divide-y divide-stage-line overflow-y-auto">
          <Field label="Name">
            <input
              value={object.name}
              onChange={(e) => renameObject(object.id, e.target.value)}
              className="w-full rounded-md border border-stage-line bg-stage-field px-2 py-1.5 text-[13px] text-stage-ink outline-none transition-colors focus:border-stage-accent focus:bg-stage-panel"
            />
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

          {object.geometry.kind === "group" && (
            <div className="px-4 py-3 text-[12px] leading-relaxed text-stage-faint">
              A group has no shape of its own. Drag objects onto it in the
              outliner to nest them.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
