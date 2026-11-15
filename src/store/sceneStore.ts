import { create } from "zustand";
import type {
  CameraHotspot,
  FaceMaterial,
  PrimitiveKind,
  SceneFile,
  SceneObject,
  TextureAsset,
  Transform,
} from "../types/scene";
import {
  DEFAULT_MATERIAL,
  IDENTITY_TRANSFORM,
  PRIMITIVE_DEFAULTS,
  PRIMITIVE_GROUP_COUNT,
  PRIMITIVE_PARAMS,
  SCENE_FORMAT_VERSION,
  clampParam,
} from "../types/scene";
import { useEditorStore } from "./editorStore";
import type { DocSnapshot } from "./historyStore";
import { COALESCE_MS, MAX_HISTORY, useHistoryStore } from "./historyStore";
import { FREEZE_ENABLED, freezeDocument } from "./devFreeze";
import {
  canReparent,
  indexObjects,
  localTransformUnderParent,
} from "../geometry/transforms";
import {
  duplicateSubtree,
  insertAfter,
  placeInOrder,
  uniqueName,
} from "../scene/hierarchy";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function uid(): string {
  return crypto.randomUUID();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Builds the full material slot map for a primitive, so every face starts
 *  with an explicit, editable entry instead of an implicit fallback. */
function defaultMaterialsFor(kind: PrimitiveKind): Record<number, FaceMaterial> {
  const out: Record<number, FaceMaterial> = {};
  for (let i = 0; i < PRIMITIVE_GROUP_COUNT[kind]; i++) {
    out[i] = clone(DEFAULT_MATERIAL);
  }
  return out;
}

const PRIMITIVE_LABEL: Record<PrimitiveKind, string> = {
  box: "Box",
  sphere: "Sphere",
  cylinder: "Cylinder",
  cone: "Cone",
  plane: "Plane",
};

/* ------------------------------------------------------------------ */
/* Store shape                                                         */
/* ------------------------------------------------------------------ */

interface SceneState {
  /* --- document --- */
  sceneName: string;
  objects: SceneObject[];
  hotspots: CameraHotspot[];
  textures: TextureAsset[];

  /** Set true by any mutation, cleared on save. Drives the unsaved dot. */
  dirty: boolean;

  /* --- object actions --- */
  addPrimitive: (kind: PrimitiveKind) => string;
  addGroup: () => string;
  /** Reparents, preserving world transform. No-op on self or cycles. */
  setParent: (id: string, parentId: string | null) => void;
  /**
   * Reparents AND repositions among siblings in one step.
   * `beforeId` null means "last child of parentId".
   */
  moveObject: (
    id: string,
    parentId: string | null,
    beforeId: string | null,
  ) => void;
  deleteObject: (id: string) => void;
  duplicateObject: (id: string) => string | null;
  renameObject: (id: string, name: string) => void;
  setTransform: (id: string, patch: Partial<Transform>) => void;
  /** Edits one numeric parameter of a primitive. Clamped to the param spec. */
  setPrimitiveParam: (id: string, name: string, value: number) => void;
  setVisible: (id: string, visible: boolean) => void;

  /* --- history --- */
  /** Opens a single undo entry covering everything until endBatch(). */
  beginBatch: (key: string) => void;
  endBatch: () => void;
  undo: () => void;
  redo: () => void;

  /* --- document actions --- */
  /** Renames the document. Not an undo step: this is driven by the filename
   *  during save/open, and Ctrl+Z should not rename your file. */
  setSceneName: (name: string) => void;
  newScene: () => void;
  loadScene: (file: SceneFile) => void;
  toSceneFile: () => SceneFile;
  markSaved: () => void;
}

/* ------------------------------------------------------------------ */
/* History plumbing                                                    */
/* ------------------------------------------------------------------ */

function snapshot(s: SceneState): DocSnapshot {
  return {
    sceneName: s.sceneName,
    objects: s.objects,
    hotspots: s.hotspots,
    textures: s.textures,
  };
}

/**
 * Pushes the CURRENT document onto the undo stack, before a mutation is
 * applied. Call this at the top of a mutating action, never after.
 *
 * `coalesce` merges repeated edits of the same thing inside a short window --
 * dragging an inspector number or typing a name should be one undo step, not
 * forty.
 */
function record(state: SceneState, key: string, coalesce = false) {
  const h = useHistoryStore.getState();

  // Inside a batch the opening snapshot already covers everything that
  // follows, so further records are noise.
  if (h.batchKey) return;

  const now = Date.now();
  if (coalesce && h.lastKey === key && now - h.lastAt < COALESCE_MS) {
    useHistoryStore.setState({ lastAt: now });
    return;
  }

  useHistoryStore.setState({
    past: [...h.past, snapshot(state)].slice(-MAX_HISTORY),
    future: [], // a new edit invalidates the redo branch
    lastKey: key,
    lastAt: now,
  });
}

function clearHistory() {
  useHistoryStore.setState({
    past: [],
    future: [],
    batchKey: null,
    lastKey: null,
    lastAt: 0,
  });
}

/** After a time-travel, the selected object may no longer exist. */
function pruneSelection(objects: SceneObject[]) {
  const editor = useEditorStore.getState();
  if (!editor.selectedId) return;
  if (!objects.some((o) => o.id === editor.selectedId)) editor.select(null);
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useSceneStore = create<SceneState>((set, get) => ({
  sceneName: "Untitled",
  objects: [],
  hotspots: [],
  textures: [],
  dirty: false,

  /* ---------------- object actions ---------------- */

  addPrimitive: (kind) => {
    record(get(), "add");

    const id = uid();
    const name = uniqueName(
      PRIMITIVE_LABEL[kind],
      get().objects.map((o) => o.name),
    );

    const object: SceneObject = {
      id,
      name,
      parentId: null,
      transform: clone(IDENTITY_TRANSFORM),
      geometry: {
        kind: "primitive",
        primitive: kind,
        params: clone(PRIMITIVE_DEFAULTS[kind]),
      },
      materials: defaultMaterialsFor(kind),
      visible: true,
      locked: false,
    };

    set((s) => ({ objects: [...s.objects, object], dirty: true }));
    useEditorStore.getState().select(id);
    return id;
  },

  addGroup: () => {
    record(get(), "add");

    const id = uid();
    const group: SceneObject = {
      id,
      name: uniqueName(
        "Group",
        get().objects.map((o) => o.name),
      ),
      parentId: null,
      transform: clone(IDENTITY_TRANSFORM),
      geometry: { kind: "group" },
      materials: {},
      visible: true,
      locked: false,
    };

    set((s) => ({ objects: [...s.objects, group], dirty: true }));
    useEditorStore.getState().select(id);
    return id;
  },

  setParent: (id, parentId) => get().moveObject(id, parentId, null),

  moveObject: (id, parentId, beforeId) => {
    const objects = get().objects;
    const byId = indexObjects(objects);

    const object = byId.get(id);
    if (!object) return;
    if (beforeId === id) return;
    if (!canReparent(id, parentId, byId)) return;

    // A `beforeId` only means anything among the target parent's own children.
    if (beforeId) {
      const anchor = byId.get(beforeId);
      if (!anchor || anchor.parentId !== parentId) return;
    }

    const reparented = object.parentId !== parentId;

    // World transform is preserved: the object stays exactly where it looks
    // like it is, and we bake the difference into its new local transform.
    const transform = reparented
      ? localTransformUnderParent(id, parentId, byId)
      : object.transform;

    const moved = { ...object, parentId, transform };
    const next = placeInOrder(objects, moved, beforeId);

    // Pure reordering within one parent is a different kind of edit from
    // moving between parents, so they get their own coalescing keys.
    record(get(), reparented ? `parent:${id}` : `reorder:${id}`);
    set({ objects: next, dirty: true });
  },

  deleteObject: (id) => {
    record(get(), "delete");

    // Remove the object and anything parented to it.
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of get().objects) {
        if (o.parentId && doomed.has(o.parentId) && !doomed.has(o.id)) {
          doomed.add(o.id);
          grew = true;
        }
      }
    }

    set((s) => ({
      objects: s.objects.filter((o) => !doomed.has(o.id)),
      dirty: true,
    }));

    const editor = useEditorStore.getState();
    if (editor.selectedId && doomed.has(editor.selectedId)) editor.select(null);
  },

  duplicateObject: (id) => {
    const objects = get().objects;

    // Copies the whole subtree, not just the object. Duplicating a group has
    // to bring its contents along, with internal parent links remapped onto
    // the new ids so the copy is self-contained.
    const result = duplicateSubtree(objects, id, uid);
    if (!result) return null;

    record(get(), "duplicate");
    set({
      objects: insertAfter(objects, id, result.copies),
      dirty: true,
    });
    useEditorStore.getState().select(result.rootCopyId);
    return result.rootCopyId;
  },

  renameObject: (id, name) => {
    record(get(), `rename:${id}`, true);
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, name } : o)),
      dirty: true,
    }));
  },

  setTransform: (id, patch) => {
    record(get(), `transform:${id}`, true);
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, transform: { ...o.transform, ...patch } } : o,
      ),
      dirty: true,
    }));
  },

  setPrimitiveParam: (id, name, value) => {
    const object = get().objects.find((o) => o.id === id);
    if (!object || object.geometry.kind !== "primitive") return;

    const spec = PRIMITIVE_PARAMS[object.geometry.primitive][name];
    if (!spec) return;

    // Clamp here, not just in the input: a value could also arrive from a
    // loaded scene file, and 50,000 radial segments would hang the renderer.
    const next = clampParam(spec, value);
    if (object.geometry.params[name] === next) return;

    record(get(), `param:${id}:${name}`, true);
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== id || o.geometry.kind !== "primitive") return o;
        return {
          ...o,
          geometry: {
            ...o.geometry,
            params: { ...o.geometry.params, [name]: next },
          },
        };
      }),
      dirty: true,
    }));
  },

  setVisible: (id, visible) => {
    record(get(), `visible:${id}`);
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, visible } : o)),
      dirty: true,
    }));
  },

  /* ---------------- history ---------------- */

  beginBatch: (key) => {
    if (useHistoryStore.getState().batchKey) return;
    // Snapshot the pre-drag state first, THEN close the gate.
    record(get(), key);
    useHistoryStore.setState({ batchKey: key });
  },

  endBatch: () => {
    if (!useHistoryStore.getState().batchKey) return;
    // lastKey is cleared so the next edit can't coalesce into the drag entry.
    useHistoryStore.setState({ batchKey: null, lastKey: null, lastAt: 0 });
  },

  undo: () => {
    const h = useHistoryStore.getState();
    if (h.batchKey || h.past.length === 0) return;

    const previous = h.past[h.past.length - 1];
    const current = snapshot(get());

    useHistoryStore.setState({
      past: h.past.slice(0, -1),
      future: [current, ...h.future].slice(0, MAX_HISTORY),
      lastKey: null,
      lastAt: 0,
    });

    set({ ...previous, dirty: true });
    pruneSelection(previous.objects);
  },

  redo: () => {
    const h = useHistoryStore.getState();
    if (h.batchKey || h.future.length === 0) return;

    const next = h.future[0];
    const current = snapshot(get());

    useHistoryStore.setState({
      past: [...h.past, current].slice(-MAX_HISTORY),
      future: h.future.slice(1),
      lastKey: null,
      lastAt: 0,
    });

    set({ ...next, dirty: true });
    pruneSelection(next.objects);
  },

  /* ---------------- document actions ---------------- */

  setSceneName: (sceneName) => set({ sceneName, dirty: true }),

  newScene: () => {
    set({
      sceneName: "Untitled",
      objects: [],
      hotspots: [],
      textures: [],
      dirty: false,
    });
    clearHistory();
    useEditorStore.getState().select(null);
  },

  loadScene: (file) => {
    set({
      sceneName: file.name,
      objects: file.objects,
      hotspots: file.hotspots,
      textures: file.textures,
      dirty: false,
    });
    clearHistory();
    useEditorStore.getState().select(null);
  },

  toSceneFile: () => {
    const s = get();
    return {
      format: "playstage-scene",
      version: SCENE_FORMAT_VERSION,
      name: s.sceneName,
      objects: s.objects,
      hotspots: s.hotspots,
      textures: s.textures,
    };
  },

  markSaved: () => set({ dirty: false }),
}));

/* ------------------------------------------------------------------ */
/* Dev-only mutation guard                                             */
/* ------------------------------------------------------------------ */

// History snapshots hold references, not copies, so any in-place edit of a
// SceneObject would rewrite the past. Freezing the document after every state
// change makes that mistake throw at the offending line instead of silently
// corrupting the undo stack. See devFreeze.ts. Dev builds only.
if (FREEZE_ENABLED) {
  freezeDocument(useSceneStore.getState());
  useSceneStore.subscribe((state) => freezeDocument(state));
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export const useSelectedObject = (): SceneObject | null => {
  const id = useEditorStore((s) => s.selectedId);
  const objects = useSceneStore((s) => s.objects);
  if (!id) return null;
  return objects.find((o) => o.id === id) ?? null;
};
