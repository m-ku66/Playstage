import { create } from "zustand";

/**
 * Editor state — everything about *how you are looking at and interacting with*
 * the scene, as opposed to the scene itself.
 *
 * Kept separate from sceneStore on purpose. The scene store is the document
 * (and will be the thing undo/redo snapshots); this store is UI state that
 * should never end up in a save file or in the undo history. Pressing Ctrl+Z
 * should not flip your gizmo back to rotate mode.
 */

export type TransformMode = "translate" | "rotate" | "scale";

interface EditorState {
  /** Currently selected object id, or null. */
  selectedId: string | null;

  /** Which gizmo is active in the viewport. */
  transformMode: TransformMode;

  /** Master switch for all three snap values below. */
  snapEnabled: boolean;
  /** World units per translate step. */
  translateSnap: number;
  /** Degrees per rotate step. Converted to radians at the gizmo. */
  rotateSnapDeg: number;
  /** Multiplier step for scale. */
  scaleSnap: number;

  /** True while a gizmo is being dragged. Used to suppress work that should
   *  not run mid-drag, and to batch the whole drag into one undo entry. */
  isDragging: boolean;

  /** Group ids whose children are hidden in the outliner. Presentation only —
   *  never saved, never undone. */
  collapsed: Record<string, boolean>;

  select: (id: string | null) => void;
  setTransformMode: (mode: TransformMode) => void;
  toggleSnap: () => void;
  setSnapEnabled: (on: boolean) => void;
  setTranslateSnap: (v: number) => void;
  setRotateSnapDeg: (v: number) => void;
  setScaleSnap: (v: number) => void;
  setDragging: (on: boolean) => void;
  toggleCollapsed: (id: string) => void;
  setCollapsed: (id: string, value: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedId: null,
  transformMode: "translate",

  snapEnabled: true,
  translateSnap: 0.25,
  rotateSnapDeg: 15,
  scaleSnap: 0.1,

  isDragging: false,
  collapsed: {},

  select: (id) => set({ selectedId: id }),
  setTransformMode: (transformMode) => set({ transformMode }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setTranslateSnap: (translateSnap) => set({ translateSnap }),
  setRotateSnapDeg: (rotateSnapDeg) => set({ rotateSnapDeg }),
  setScaleSnap: (scaleSnap) => set({ scaleSnap }),
  setDragging: (isDragging) => set({ isDragging }),

  toggleCollapsed: (id) =>
    set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),

  setCollapsed: (id, value) =>
    set((s) => ({ collapsed: { ...s.collapsed, [id]: value } })),
}));
