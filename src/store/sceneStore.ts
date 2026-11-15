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
import { useEditorStore, usePrimaryId } from "./editorStore";
import type { DocSnapshot } from "./historyStore";
import { COALESCE_MS, MAX_HISTORY, useHistoryStore } from "./historyStore";
import { FREEZE_ENABLED, freezeDocument } from "./devFreeze";
import {
  canReparent,
  indexObjects,
  localTransformUnderParent,
  worldCentroid,
  worldToLocalPosition,
} from "../geometry/transforms";
import {
  duplicateSubtree,
  insertAfter,
  placeInOrder,
  subtreeIds,
  uniqueName,
} from "../scene/hierarchy";
import { topmostIds } from "../scene/selection";
import type { CameraPose } from "../scene/hotspots";
import { clampFov, makeHotspot } from "../scene/hotspots";

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
  /**
   * Wraps the current selection in a new group.
   *
   * The group's origin lands at the centre of the selection rather than at
   * the world origin, which is what makes rotating and scaling the group
   * pivot around the objects instead of swinging them through an arc.
   *
   * Returns the new group's id, or null when nothing is selected.
   */
  groupSelection: () => string | null;
  /**
   * Dissolves every selected group by one level, freeing its children into
   * the group's own parent and then removing the empty shell.
   *
   * One level only: ungrouping a group that contains groups leaves those
   * intact. Returns the ids that were freed.
   */
  ungroupSelection: () => string[];
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
  /** Deletes several objects, with their descendants, as one undo entry. */
  deleteObjects: (ids: readonly string[]) => void;
  duplicateObject: (id: string) => string | null;
  /** Duplicates several subtrees as one undo entry. Returns the new roots. */
  duplicateObjects: (ids: readonly string[]) => string[];
  renameObject: (id: string, name: string) => void;
  setTransform: (id: string, patch: Partial<Transform>) => void;
  /** Edits one numeric parameter of a primitive. Clamped to the param spec. */
  setPrimitiveParam: (id: string, name: string, value: number) => void;
  setVisible: (id: string, visible: boolean) => void;
  setVisibleMany: (ids: readonly string[], visible: boolean) => void;
  /**
   * Locking makes an object unpickable: clicks in the viewport pass straight
   * through it and clicking its outliner row does nothing.
   *
   * Deliberately narrow. It does NOT cascade to children, so a locked group
   * pins the whole assembly against stray viewport clicks while still letting
   * you open it in the outliner and adjust one piece on purpose. It also does
   * not clear an existing selection, which would otherwise strand you with no
   * way back to the unlock control.
   */
  setLocked: (id: string, locked: boolean) => void;
  setLockedMany: (ids: readonly string[], locked: boolean) => void;

  /* --- camera hotspots --- */
  /** Saves a captured camera pose as a new angle. Returns its id. */
  addHotspot: (pose: CameraPose) => string;
  /** Replaces a saved angle's pose with a freshly captured one. */
  updateHotspot: (id: string, pose: CameraPose) => void;
  renameHotspot: (id: string, name: string) => void;
  setHotspotFov: (id: string, fov: number) => void;
  deleteHotspot: (id: string) => void;

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

/** After a time-travel, some selected things may no longer exist. */
function pruneSelection(objects: SceneObject[], hotspots: CameraHotspot[]) {
  const editor = useEditorStore.getState();

  if (editor.selectedIds.length > 0) {
    const alive = new Set(objects.map((o) => o.id));
    const kept = editor.selectedIds.filter((id) => alive.has(id));
    if (kept.length !== editor.selectedIds.length) editor.setSelection(kept);
  }

  if (
    editor.activeHotspotId &&
    !hotspots.some((h) => h.id === editor.activeHotspotId)
  ) {
    editor.setActiveHotspot(null);
  }
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

  groupSelection: () => {
    const objects = get().objects;
    // Reduced to selection roots: a child whose parent is also being grouped
    // travels with that parent, and moving it separately would pull it out.
    const tops = topmostIds(objects, useEditorStore.getState().selectedIds);
    if (tops.length === 0) return null;

    const byId = indexObjects(objects);

    // Grouping siblings keeps the new group where they already were in the
    // hierarchy. A selection spanning different parents has no such place,
    // so it goes to the top level.
    const parents = new Set(tops.map((id) => byId.get(id)?.parentId ?? null));
    const parentId = parents.size === 1 ? ([...parents][0] ?? null) : null;

    const centre = worldCentroid(tops, byId);

    const id = uid();
    const group: SceneObject = {
      id,
      name: uniqueName(
        "Group",
        objects.map((o) => o.name),
      ),
      parentId,
      transform: {
        ...clone(IDENTITY_TRANSFORM),
        position: worldToLocalPosition(centre, parentId, byId),
      },
      geometry: { kind: "group" },
      materials: {},
      visible: true,
      locked: false,
    };

    // Creating the group and absorbing the selection is one edit, so the
    // whole thing collapses into a single undo entry.
    get().beginBatch("group");

    // Slotted in at the first member's position rather than appended, so the
    // group appears in the outliner where the objects used to be.
    const at = objects.findIndex((o) => o.id === tops[0]);
    set({
      objects:
        at === -1
          ? [...objects, group]
          : [...objects.slice(0, at), group, ...objects.slice(at)],
      dirty: true,
    });

    // moveObject preserves world transforms, so nothing appears to shift.
    for (const topId of tops) get().moveObject(topId, id, null);

    get().endBatch();
    useEditorStore.getState().select(id);
    return id;
  },

  ungroupSelection: () => {
    const selected = new Set(useEditorStore.getState().selectedIds);
    const groups = get().objects.filter(
      (o) => selected.has(o.id) && o.geometry.kind === "group",
    );
    if (groups.length === 0) return [];

    get().beginBatch("ungroup");

    const freed: string[] = [];
    for (const group of groups) {
      // Re-read each pass: an earlier iteration may already have moved
      // things around if the user selected nested groups.
      const children = get().objects.filter((o) => o.parentId === group.id);

      // Anchored before the group itself, so the children end up occupying
      // the slot the group held and keep their order among themselves.
      for (const child of children) {
        get().moveObject(child.id, group.parentId, group.id);
        freed.push(child.id);
      }

      // Safe now that it is empty: deleteObjects takes whole subtrees, and
      // this one has nothing left in it.
      get().deleteObjects([group.id]);
    }

    get().endBatch();
    useEditorStore.getState().setSelection(freed);
    return freed;
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

  deleteObject: (id) => get().deleteObjects([id]),

  deleteObjects: (ids) => {
    if (ids.length === 0) return;
    record(get(), "delete");

    // Deleting an object takes its descendants with it, so the doomed set is
    // the union of every selected subtree. An overlapping selection -- a group
    // and one of its own children -- collapses into the same set harmlessly.
    const objects = get().objects;
    const doomed = new Set<string>();
    for (const id of ids) {
      for (const member of subtreeIds(objects, id)) doomed.add(member);
    }

    set({ objects: objects.filter((o) => !doomed.has(o.id)), dirty: true });

    const editor = useEditorStore.getState();
    editor.setSelection(editor.selectedIds.filter((id) => !doomed.has(id)));
  },

  duplicateObject: (id) => get().duplicateObjects([id])[0] ?? null,

  duplicateObjects: (ids) => {
    // Reduced to selection roots first. Duplicating a group and one of its own
    // children while both are selected would otherwise copy that child twice:
    // once inside the group's copy, once again on its own.
    const tops = topmostIds(get().objects, ids);
    if (tops.length === 0) return [];

    record(get(), "duplicate");

    // Threaded through the loop rather than re-read from the store each pass,
    // so uniqueName sees the copies made earlier in this same batch and does
    // not hand out the same name twice.
    let objects = get().objects;
    const rootCopyIds: string[] = [];

    for (const id of tops) {
      const result = duplicateSubtree(objects, id, uid);
      if (!result) continue;
      objects = insertAfter(objects, id, result.copies);
      rootCopyIds.push(result.rootCopyId);
    }

    set({ objects, dirty: true });
    useEditorStore.getState().setSelection(rootCopyIds);
    return rootCopyIds;
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

  setVisible: (id, visible) => get().setVisibleMany([id], visible),

  setVisibleMany: (ids, visible) => {
    if (ids.length === 0) return;
    record(get(), "visible");
    const target = new Set(ids);
    set((s) => ({
      objects: s.objects.map((o) => (target.has(o.id) ? { ...o, visible } : o)),
      dirty: true,
    }));
  },

  setLocked: (id, locked) => get().setLockedMany([id], locked),

  setLockedMany: (ids, locked) => {
    if (ids.length === 0) return;
    record(get(), "locked");
    const target = new Set(ids);
    set((s) => ({
      objects: s.objects.map((o) => (target.has(o.id) ? { ...o, locked } : o)),
      dirty: true,
    }));
  },

  /* ---------------- camera hotspots ---------------- */

  addHotspot: (pose) => {
    record(get(), "hotspot:add");

    const id = uid();
    const hotspot = makeHotspot(
      id,
      uniqueName(
        "View",
        get().hotspots.map((h) => h.name),
      ),
      pose,
    );

    set((s) => ({ hotspots: [...s.hotspots, hotspot], dirty: true }));
    useEditorStore.getState().setActiveHotspot(id);
    return id;
  },

  updateHotspot: (id, pose) => {
    const existing = get().hotspots.find((h) => h.id === id);
    if (!existing) return;

    record(get(), `hotspot:update:${id}`);
    set((s) => ({
      // Name is kept; only the angle is replaced. Recapturing is for nudging
      // a saved view, not for starting a new one.
      hotspots: s.hotspots.map((h) =>
        h.id === id ? makeHotspot(h.id, h.name, pose) : h,
      ),
      dirty: true,
    }));
  },

  renameHotspot: (id, name) => {
    record(get(), `hotspot:rename:${id}`, true);
    set((s) => ({
      hotspots: s.hotspots.map((h) => (h.id === id ? { ...h, name } : h)),
      dirty: true,
    }));
  },

  setHotspotFov: (id, fov) => {
    const next = clampFov(fov);
    const existing = get().hotspots.find((h) => h.id === id);
    if (!existing || existing.fov === next) return;

    record(get(), `hotspot:fov:${id}`, true);
    set((s) => ({
      hotspots: s.hotspots.map((h) => (h.id === id ? { ...h, fov: next } : h)),
      dirty: true,
    }));
  },

  deleteHotspot: (id) => {
    if (!get().hotspots.some((h) => h.id === id)) return;

    record(get(), "hotspot:delete");
    set((s) => ({
      hotspots: s.hotspots.filter((h) => h.id !== id),
      dirty: true,
    }));

    const editor = useEditorStore.getState();
    if (editor.activeHotspotId === id) editor.setActiveHotspot(null);
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
    pruneSelection(previous.objects, previous.hotspots);
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
    pruneSelection(next.objects, next.hotspots);
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
    useEditorStore.getState().setActiveHotspot(null);
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
    useEditorStore.getState().setActiveHotspot(null);
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

/** The active object: the most recently selected one. Null when the selection
 *  is empty. With several objects selected this is the one the inspector and
 *  the gizmo follow. */
export const useSelectedObject = (): SceneObject | null => {
  const id = usePrimaryId();
  const objects = useSceneStore((s) => s.objects);
  if (!id) return null;
  return objects.find((o) => o.id === id) ?? null;
};
