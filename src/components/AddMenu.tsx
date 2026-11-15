import { useEffect, useState } from "react";
import type { PrimitiveKind } from "../types/scene";
import { useSceneStore } from "../store/sceneStore";
import { useSelectedIds } from "../store/editorStore";

/**
 * One button for everything that adds or restructures geometry.
 *
 * Replaces six separate toolbar buttons. The group actions live in here too
 * rather than beside it: they are the same kind of thing (make something new
 * out of what is in the scene) and they are reachable by shortcut anyway, so
 * the menu is where they can be discovered without costing permanent toolbar
 * space.
 */

const PRIMITIVES: { kind: PrimitiveKind; label: string }[] = [
  { kind: "box", label: "Box" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "sphere", label: "Sphere" },
  { kind: "cone", label: "Cone" },
  { kind: "plane", label: "Plane" },
];

function MenuLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-[9px] font-medium uppercase tracking-[0.12em] text-stage-faint">
      {children}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
        disabled
          ? "cursor-default text-stage-line-strong"
          : "text-stage-ink hover:bg-stage-accent-soft hover:text-stage-accent"
      }`}
    >
      <span>{label}</span>
      {hint && (
        <span className="font-mono text-[10px] text-stage-faint">{hint}</span>
      )}
    </button>
  );
}

export function AddMenu() {
  const [open, setOpen] = useState(false);

  const addPrimitive = useSceneStore((s) => s.addPrimitive);
  const addGroup = useSceneStore((s) => s.addGroup);
  const groupSelection = useSceneStore((s) => s.groupSelection);
  const ungroupSelection = useSceneStore((s) => s.ungroupSelection);

  const selectedIds = useSelectedIds();
  // Boolean selector, so the toolbar does not re-render on every frame of a
  // gizmo drag just because it is watching the object list.
  const canUngroup = useSceneStore((s) =>
    s.objects.some(
      (o) => selectedIds.includes(o.id) && o.geometry.kind === "group",
    ),
  );

  // While the menu is open, Escape should close it rather than clear the
  // selection. Registered in the capture phase so it runs before the global
  // shortcut handler, which is also bound to window.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      e.stopPropagation();
      e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  /** Every item closes the menu after acting. */
  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Add a shape, or group what is selected"
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
          open
            ? "bg-stage-accent-soft text-stage-accent"
            : "text-stage-muted hover:bg-stage-accent-soft hover:text-stage-accent"
        }`}
      >
        Add
        <span className="text-[8px] leading-none">▼</span>
      </button>

      {open && (
        <>
          {/* Catches a click anywhere else. Covers the viewport too, so the
              click that dismisses the menu cannot also hit an object. */}
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-30 mt-1.5 w-56 rounded-lg border border-stage-line bg-stage-panel p-1 shadow-[0_10px_28px_rgba(0,0,0,0.12)]">
            <MenuLabel>Shapes</MenuLabel>
            {PRIMITIVES.map((p) => (
              <MenuItem
                key={p.kind}
                label={p.label}
                onClick={run(() => addPrimitive(p.kind))}
              />
            ))}

            <div className="my-1 h-px bg-stage-line" />

            <MenuLabel>Groups</MenuLabel>
            <MenuItem
              label={
                selectedIds.length > 0
                  ? `Group ${selectedIds.length} selected`
                  : "Group selection"
              }
              hint="Ctrl+G"
              disabled={selectedIds.length === 0}
              onClick={run(() => groupSelection())}
            />
            <MenuItem
              label="Ungroup"
              hint="Ctrl+⇧G"
              disabled={!canUngroup}
              onClick={run(() => ungroupSelection())}
            />
            <MenuItem
              label="Empty group"
              onClick={run(() => addGroup())}
            />
          </div>
        </>
      )}
    </div>
  );
}
