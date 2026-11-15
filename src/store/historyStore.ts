import { create } from "zustand";
import type { CameraHotspot, SceneObject, TextureAsset } from "../types/scene";

/**
 * Undo/redo history.
 *
 * This store is a dumb container -- it holds the stacks and nothing else. All
 * the logic that pushes, pops and applies snapshots lives in sceneStore, which
 * drives this via setState. Keeping the dependency one-directional
 * (sceneStore -> historyStore) avoids a circular import between the two.
 *
 * Snapshots hold references, not deep clones. That is safe because every
 * sceneStore action replaces arrays and objects rather than mutating them, so
 * an old snapshot can never be changed out from under us. It also means
 * history costs almost nothing in memory: unchanged objects are shared across
 * every entry.
 */

export interface DocSnapshot {
  sceneName: string;
  objects: SceneObject[];
  hotspots: CameraHotspot[];
  textures: TextureAsset[];
}

/** How many undo steps to keep. Snapshots share structure, so this is cheap. */
export const MAX_HISTORY = 100;

/** Edits with the same key landing within this window merge into one entry,
 *  so typing a name is one undo rather than one per keystroke. */
export const COALESCE_MS = 600;

interface HistoryState {
  past: DocSnapshot[];
  future: DocSnapshot[];

  /** Non-null while a multi-step edit (a gizmo drag) is in flight. While set,
   *  no further entries are recorded -- the whole drag is one undo step. */
  batchKey: string | null;

  /** Key and timestamp of the most recent entry, for coalescing. */
  lastKey: string | null;
  lastAt: number;
}

export const useHistoryStore = create<HistoryState>(() => ({
  past: [],
  future: [],
  batchKey: null,
  lastKey: null,
  lastAt: 0,
}));

export const useCanUndo = () => useHistoryStore((s) => s.past.length > 0);
export const useCanRedo = () => useHistoryStore((s) => s.future.length > 0);
