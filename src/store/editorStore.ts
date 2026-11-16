import { create } from "zustand";
import { toggleId } from "../scene/selection";
import type { UnitSystem } from "../scene/units";

/**
 * Editor state — everything about *how you are looking at and interacting with*
 * the scene, as opposed to the scene itself.
 *
 * Kept separate from sceneStore on purpose. The scene store is the document
 * (and the thing undo/redo snapshots); this store is UI state that should
 * never end up in a save file or in the undo history. Pressing Ctrl+Z should
 * not flip your gizmo back to rotate mode, or change what is selected beyond
 * dropping objects that no longer exist.
 */

export type TransformMode = "translate" | "rotate" | "scale";

interface EditorState {
  /**
   * Selected object ids, in the order they were added.
   *
   * An array rather than a Set: order carries meaning. The LAST entry is the
   * active object — the one the inspector shows and the gizmo attaches to —
   * which matches how shift-clicking feels in every other editor.
   */
  selectedIds: string[];

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

  /** Which units every measurement is shown in. Display only: the scene file
   *  is always in world units, so switching cannot alter geometry. */
  unitSystem: UnitSystem;
  /** Numbered ticks on the ground plane. Correct from any camera angle. */
  showGroundRuler: boolean;
  /** Ruler strips along the viewport edges. Only exact at the focus depth. */
  showEdgeRuler: boolean;

  /** Whether the keyboard reference modal is up. */
  shortcutsOpen: boolean;

  /**
   * The texture tile highlighted in the tray, if any.
   *
   * Like activeHotspotId, this is not a scene selection: it decides which tray
   * tile shows its rename/remove controls, and nothing else. Clicking a tile
   * both highlights it and applies it, so this is a record of the last thing
   * you reached for rather than a mode you have to be in.
   */
  activeTextureId: string | null;

  /** Whether the texture tray strip under the viewport is expanded. Collapsed
   *  gives its height back to the viewport, which is the scarce resource. */
  textureTrayOpen: boolean;

  /**
   * Which material slot of the selected object the inspector is editing.
   *
   * Held as a bare number rather than per-object, so moving between two boxes
   * keeps you on the same face instead of resetting to Right every time --
   * texturing the tops of six crates in a row is the common case. Readers
   * clamp it against the current object's slot count, since selecting a
   * cylinder while slot 5 is active would otherwise point at nothing.
   */
  activeSlot: number;

  /**
   * The slot being hovered in the inspector, highlighted in the viewport.
   *
   * Carries the object id as well as the index: the highlight has to vanish
   * when the selection moves on, and an index alone would leave it painted on
   * whatever got selected next.
   */
  highlightedSlot: { objectId: string; slot: number } | null;

  /**
   * The saved camera angle being edited, if any.
   *
   * Not a selection in the scene sense -- it never ends up in the save file
   * and it is not what the gizmo or the inspector follow. It only decides
   * which row of the views panel is expanded.
   */
  activeHotspotId: string | null;

  /** Replaces the whole selection. null clears it. */
  select: (id: string | null) => void;
  /** Adds or removes one id, leaving the rest alone. Shift-click. */
  toggleSelected: (id: string) => void;
  /** Replaces the selection with an explicit list. */
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;

  setTransformMode: (mode: TransformMode) => void;
  toggleSnap: () => void;
  setSnapEnabled: (on: boolean) => void;
  setTranslateSnap: (v: number) => void;
  setRotateSnapDeg: (v: number) => void;
  setScaleSnap: (v: number) => void;
  setDragging: (on: boolean) => void;
  setUnitSystem: (system: UnitSystem) => void;
  toggleGroundRuler: () => void;
  toggleEdgeRuler: () => void;
  setShortcutsOpen: (open: boolean) => void;
  setActiveHotspot: (id: string | null) => void;
  setActiveTexture: (id: string | null) => void;
  toggleTextureTray: () => void;
  setActiveSlot: (slot: number) => void;
  setHighlightedSlot: (value: { objectId: string; slot: number } | null) => void;
  toggleCollapsed: (id: string) => void;
  setCollapsed: (id: string, value: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedIds: [],
  transformMode: "translate",

  snapEnabled: true,
  translateSnap: 0.25,
  rotateSnapDeg: 15,
  scaleSnap: 0.1,

  isDragging: false,
  collapsed: {},

  unitSystem: "metric",
  // The accurate ruler is on by default; the edge strips are opt-in, since
  // they add screen clutter and are only exact at one depth.
  showGroundRuler: true,
  showEdgeRuler: false,
  shortcutsOpen: false,
  activeHotspotId: null,
  activeTextureId: null,
  textureTrayOpen: true,
  activeSlot: 0,
  highlightedSlot: null,

  select: (id) => set({ selectedIds: id ? [id] : [] }),
  toggleSelected: (id) =>
    set((s) => ({ selectedIds: toggleId(s.selectedIds, id) })),
  setSelection: (selectedIds) => set({ selectedIds }),
  clearSelection: () => set({ selectedIds: [] }),

  setTransformMode: (transformMode) => set({ transformMode }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setTranslateSnap: (translateSnap) => set({ translateSnap }),
  setRotateSnapDeg: (rotateSnapDeg) => set({ rotateSnapDeg }),
  setScaleSnap: (scaleSnap) => set({ scaleSnap }),
  setDragging: (isDragging) => set({ isDragging }),
  setUnitSystem: (unitSystem) => set({ unitSystem }),
  toggleGroundRuler: () =>
    set((s) => ({ showGroundRuler: !s.showGroundRuler })),
  toggleEdgeRuler: () => set((s) => ({ showEdgeRuler: !s.showEdgeRuler })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setActiveHotspot: (activeHotspotId) => set({ activeHotspotId }),
  setActiveTexture: (activeTextureId) => set({ activeTextureId }),
  toggleTextureTray: () =>
    set((s) => ({ textureTrayOpen: !s.textureTrayOpen })),
  setActiveSlot: (activeSlot) => set({ activeSlot }),
  setHighlightedSlot: (highlightedSlot) => set({ highlightedSlot }),

  toggleCollapsed: (id) =>
    set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),

  setCollapsed: (id, value) =>
    set((s) => ({ collapsed: { ...s.collapsed, [id]: value } })),
}));

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** The active object id: the most recently added to the selection. */
export const usePrimaryId = (): string | null =>
  useEditorStore((s) => s.selectedIds[s.selectedIds.length - 1] ?? null);

export const useSelectedIds = (): string[] =>
  useEditorStore((s) => s.selectedIds);

export const useIsSelected = (id: string): boolean =>
  useEditorStore((s) => s.selectedIds.includes(id));

export const useSelectionCount = (): number =>
  useEditorStore((s) => s.selectedIds.length);
