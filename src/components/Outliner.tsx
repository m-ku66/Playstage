import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { SceneObject } from "../types/scene";
import {
  canReparent,
  childrenByParent,
  indexObjects,
} from "../geometry/transforms";
import { nextSiblingId } from "../scene/hierarchy";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";

const DRAG_MIME = "application/x-playstage-object";
const INDENT_PX = 14;
/** Fraction of a row's height at each end that means "insert", not "nest". */
const EDGE_ZONE = 0.3;

type DropMode = "before" | "after" | "inside";
interface DropIntent {
  targetId: string;
  mode: DropMode;
}

export function Outliner() {
  const objects = useSceneStore((s) => s.objects);
  const setVisible = useSceneStore((s) => s.setVisible);
  const deleteObject = useSceneStore((s) => s.deleteObject);
  const duplicateObject = useSceneStore((s) => s.duplicateObject);
  const moveObject = useSceneStore((s) => s.moveObject);

  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const collapsed = useEditorStore((s) => s.collapsed);
  const toggleCollapsed = useEditorStore((s) => s.toggleCollapsed);

  /** Id being dragged. Kept in React state as well as on the DataTransfer,
   *  because dragover cannot read DataTransfer contents for security reasons —
   *  only drop can. Without it we could not validate or preview a drop while
   *  hovering, and every row would light up as a legal target. */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [intent, setIntent] = useState<DropIntent | null>(null);
  const [overRoot, setOverRoot] = useState(false);

  const byId = useMemo(() => indexObjects(objects), [objects]);
  const childrenOf = useMemo(() => childrenByParent(objects), [objects]);
  const roots = childrenOf.get(null) ?? [];

  /** Resolves a hover into the (parent, before) pair moveObject wants. */
  const resolveDrop = (
    target: SceneObject,
    mode: DropMode,
  ): { parentId: string | null; beforeId: string | null } =>
    mode === "inside"
      ? { parentId: target.id, beforeId: null }
      : {
          parentId: target.parentId,
          beforeId:
            mode === "before"
              ? target.id
              : nextSiblingId(objects, target.id),
        };

  const isLegal = (target: SceneObject, mode: DropMode) => {
    if (!draggingId || draggingId === target.id) return false;
    const { parentId } = resolveDrop(target, mode);
    return canReparent(draggingId, parentId, byId);
  };

  const clearDrag = () => {
    setDraggingId(null);
    setIntent(null);
    setOverRoot(false);
  };

  const modeFromPointer = (e: DragEvent, el: HTMLElement): DropMode => {
    const box = el.getBoundingClientRect();
    const ratio = (e.clientY - box.top) / box.height;
    if (ratio < EDGE_ZONE) return "before";
    if (ratio > 1 - EDGE_ZONE) return "after";
    return "inside";
  };

  const renderRow = (object: SceneObject, depth: number) => {
    const active = object.id === selectedId;
    const children = childrenOf.get(object.id);
    const hasChildren = Boolean(children?.length);
    const isCollapsed = Boolean(collapsed[object.id]);
    const isGroup = object.geometry.kind === "group";
    const beingDragged = draggingId === object.id;

    const showing = intent?.targetId === object.id ? intent.mode : null;

    return (
      <div key={object.id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, object.id);
            e.dataTransfer.effectAllowed = "move";
            setDraggingId(object.id);
            // A collapsed group cannot have something dropped into a child
            // the user cannot see, so fold it while it travels.
            if (hasChildren) toggleCollapsed(object.id);
          }}
          onDragEnd={clearDrag}
          onDragOver={(e) => {
            if (!draggingId) return;
            const mode = modeFromPointer(e, e.currentTarget);
            if (!isLegal(object, mode)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            setOverRoot(false);
            setIntent({ targetId: object.id, mode });
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = e.dataTransfer.getData(DRAG_MIME) || draggingId;
            const mode = modeFromPointer(e, e.currentTarget);
            if (id && isLegal(object, mode)) {
              const { parentId, beforeId } = resolveDrop(object, mode);
              moveObject(id, parentId, beforeId);
            }
            clearDrag();
          }}
          onClick={() => select(object.id)}
          style={{ paddingLeft: 4 + depth * INDENT_PX }}
          className={`group relative flex cursor-default items-center gap-1.5 rounded-md py-1.5 pr-2 text-[13px] transition-colors ${
            showing === "inside"
              ? "bg-stage-accent-soft ring-1 ring-stage-accent"
              : active
                ? "bg-stage-accent-soft text-stage-accent"
                : "text-stage-ink hover:bg-stage-field"
          } ${beingDragged ? "opacity-40" : ""}`}
        >
          {/* Insertion lines for reordering. */}
          {showing === "before" && <InsertLine edge="top" />}
          {showing === "after" && <InsertLine edge="bottom" />}

          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(object.id);
            }}
            disabled={!hasChildren}
            title={hasChildren ? (isCollapsed ? "Expand" : "Collapse") : ""}
            className={`w-3 shrink-0 text-[9px] leading-none transition-transform ${
              hasChildren
                ? "text-stage-muted hover:text-stage-ink"
                : "text-transparent"
            } ${hasChildren && !isCollapsed ? "rotate-90" : ""}`}
          >
            ▶
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setVisible(object.id, !object.visible);
            }}
            title={object.visible ? "Hide (H)" : "Show (H)"}
            className={`shrink-0 text-[11px] leading-none transition-colors ${
              object.visible
                ? "text-stage-faint hover:text-stage-ink"
                : "text-stage-line-strong hover:text-stage-muted"
            }`}
          >
            {object.visible ? "●" : "○"}
          </button>

          <span className="flex-1 truncate">
            {object.name}
            {isGroup && hasChildren && isCollapsed && (
              <span className="ml-1.5 font-mono text-[10px] text-stage-faint">
                {children?.length}
              </span>
            )}
          </span>

          <button
            onClick={(e) => {
              e.stopPropagation();
              duplicateObject(object.id);
            }}
            title="Duplicate (Ctrl+D)"
            className="invisible shrink-0 text-[11px] leading-none text-stage-faint transition-colors group-hover:visible hover:text-stage-ink"
          >
            ⧉
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteObject(object.id);
            }}
            title="Delete (Del)"
            className="invisible shrink-0 text-[11px] leading-none text-stage-faint transition-colors group-hover:visible hover:text-stage-warn"
          >
            ✕
          </button>
        </div>

        {hasChildren &&
          !isCollapsed &&
          children?.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-stage-line bg-stage-panel">
      <div className="px-4 pt-4 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint">
        Scene
      </div>

      {/* The empty area below the list is the "move to top level" target. */}
      <div
        onDragOver={(e) => {
          if (!draggingId || !canReparent(draggingId, null, byId)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setIntent(null);
          setOverRoot(true);
        }}
        onDragLeave={() => setOverRoot(false)}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG_MIME) || draggingId;
          if (id) moveObject(id, null, null);
          clearDrag();
        }}
        className={`flex-1 overflow-y-auto px-2 pb-2 transition-colors ${
          overRoot ? "bg-stage-accent-soft/40" : ""
        }`}
      >
        {objects.length === 0 && (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-stage-faint">
            Nothing here yet. Add a shape from the toolbar.
          </p>
        )}

        {roots.map((o) => renderRow(o, 0))}

        {draggingId && (
          <p className="mt-2 rounded-md border border-dashed border-stage-line px-2 py-2 text-[11px] leading-snug text-stage-faint">
            Drop on the middle of a row to nest it, near its top or bottom edge
            to reorder. Drop below the list for the top level.
          </p>
        )}
      </div>

      <ShortcutLegend />
    </aside>
  );
}

function InsertLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-stage-accent ${
        edge === "top" ? "top-0" : "bottom-0"
      }`}
    />
  );
}

const SHORTCUTS: [string, string][] = [
  ["W / E / R", "Move / Rotate / Scale"],
  ["X", "Toggle snap"],
  ["H", "Hide / show"],
  ["Ctrl+D", "Duplicate"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+⇧Z", "Redo"],
  ["Del", "Delete"],
  ["Esc", "Deselect"],
];

function ShortcutLegend() {
  return (
    <div className="border-t border-stage-line px-4 py-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint">
        Keys
      </div>
      <dl className="space-y-1">
        {SHORTCUTS.map(([key, label]) => (
          <div key={key} className="flex items-baseline justify-between gap-2">
            <dt className="font-mono text-[10px] text-stage-muted">{key}</dt>
            <dd className="truncate text-[11px] text-stage-faint">{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
