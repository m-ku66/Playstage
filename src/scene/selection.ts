import type { SceneObject } from "../types/scene";
import type { ObjectIndex } from "../geometry/transforms";

/**
 * Pure selection logic.
 *
 * Split out of the stores for the same reason hierarchy.ts is: these are the
 * rules that decide what a click means, and they are worth testing directly
 * rather than through a live store and a renderer.
 */

/**
 * The outermost ancestor of `id` — the top-level object its subtree hangs
 * from. Returns `id` itself for an object already at the top level.
 *
 * This is what a viewport click resolves to. Clicking a wall of a grouped
 * building selects the building, not the wall: the member stays reachable
 * through the outliner, where picking a specific one is deliberate rather
 * than accidental.
 *
 * The `seen` set is defensive. parseSceneFile breaks parentId cycles on load
 * and moveObject refuses to create them, but this runs on every click and an
 * infinite loop here would hang the app, so it costs nothing to be sure.
 */
export function outermostAncestorId(byId: ObjectIndex, id: string): string {
  const seen = new Set<string>();
  let current = byId.get(id);
  if (!current) return id;

  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

/**
 * Reduces a set of ids to the roots of the selection: every id that does not
 * have another selected id above it.
 *
 * Needed by any operation that walks a subtree. Duplicating a group and one
 * of its children while both are selected would otherwise copy that child
 * twice — once as part of the group, once on its own.
 *
 * Returns ids in the order they appear in `objects`, so a batch operation
 * applies in scene order rather than click order.
 */
export function topmostIds(
  objects: SceneObject[],
  ids: readonly string[],
): string[] {
  const selected = new Set(ids);
  const byId = new Map(objects.map((o) => [o.id, o]));

  const hasSelectedAncestor = (object: SceneObject): boolean => {
    const seen = new Set<string>();
    let parentId = object.parentId;

    while (parentId && !seen.has(parentId)) {
      if (selected.has(parentId)) return true;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  };

  return objects
    .filter((o) => selected.has(o.id) && !hasSelectedAncestor(o))
    .map((o) => o.id);
}

/**
 * Adds or removes `id` from a selection, preserving order.
 *
 * The last entry is the active object, so re-adding something moves it to the
 * end and makes it active — which is what shift-clicking an already-selected
 * object and then shift-clicking it again should feel like.
 */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
