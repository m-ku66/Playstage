import type { SceneObject } from "../types/scene";

/**
 * Pure operations on the flat object list.
 *
 * Split out of sceneStore so they can be tested directly rather than through
 * a live store. Everything here returns new arrays and objects; nothing is
 * mutated in place, which is what lets undo snapshots hold references safely.
 *
 * Ordering convention: an object's position in the array decides its order
 * among its siblings. Absolute position does not matter, only relative order
 * within a parent, since the renderer and outliner group by `parentId`.
 */

/** "Box", "Box 2", "Box 3"... so the outliner stays readable. */
export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Strips a trailing " 2" so duplicating "Box 2" gives "Box 3", not "Box 2 2". */
export function baseName(name: string): string {
  return name.replace(/ \d+$/, "");
}

/** The id plus every id beneath it, however deep. */
export function subtreeIds(objects: SceneObject[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of objects) {
      if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) {
        ids.add(o.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Copies an object and everything under it.
 *
 * Every copy gets a fresh id, and internal parent links are remapped onto the
 * new ids so the copied subtree is self-contained rather than pointing back
 * at the originals. The root copy keeps the source's own parent, so a
 * duplicated group lands beside the one it came from.
 *
 * `makeId` is injected rather than called directly so tests can produce
 * predictable ids.
 */
export function duplicateSubtree(
  objects: SceneObject[],
  rootId: string,
  makeId: () => string,
): { copies: SceneObject[]; rootCopyId: string } | null {
  const root = objects.find((o) => o.id === rootId);
  if (!root) return null;

  const ids = subtreeIds(objects, rootId);
  // filter preserves array order, so copied siblings keep their ordering.
  const subtree = objects.filter((o) => ids.has(o.id));

  const idMap = new Map<string, string>();
  for (const o of subtree) idMap.set(o.id, makeId());

  const taken = objects.map((o) => o.name);
  const copies = subtree.map((o) => {
    const name = uniqueName(baseName(o.name), taken);
    taken.push(name);
    return {
      ...structuredClone(o),
      id: idMap.get(o.id) as string,
      name,
      parentId:
        o.id === rootId ? o.parentId : (idMap.get(o.parentId as string) ?? null),
    };
  });

  return { copies, rootCopyId: idMap.get(rootId) as string };
}

/** Splices a block of objects in directly after `anchorId`. */
export function insertAfter(
  objects: SceneObject[],
  anchorId: string,
  inserted: SceneObject[],
): SceneObject[] {
  const at = objects.findIndex((o) => o.id === anchorId);
  if (at === -1) return [...objects, ...inserted];
  return [...objects.slice(0, at + 1), ...inserted, ...objects.slice(at + 1)];
}

/**
 * Repositions one object in the list.
 *
 * With `beforeId`, it lands immediately before that object. Without one, it
 * lands after the last of its new siblings, i.e. at the end of that parent's
 * children.
 *
 * Only the object itself moves. Its descendants stay where they are in the
 * array, which is harmless: their order relative to each other is unchanged,
 * and that is all that decides how they render.
 */
export function placeInOrder(
  objects: SceneObject[],
  moved: SceneObject,
  beforeId: string | null,
): SceneObject[] {
  const without = objects.filter((o) => o.id !== moved.id);

  if (beforeId) {
    const at = without.findIndex((o) => o.id === beforeId);
    if (at >= 0) return [...without.slice(0, at), moved, ...without.slice(at)];
  }

  let lastSibling = -1;
  without.forEach((o, i) => {
    if (o.parentId === moved.parentId) lastSibling = i;
  });

  return lastSibling >= 0
    ? [...without.slice(0, lastSibling + 1), moved, ...without.slice(lastSibling + 1)]
    : [...without, moved];
}

/** The id that follows `id` among its siblings, or null if it is last. */
export function nextSiblingId(
  objects: SceneObject[],
  id: string,
): string | null {
  const object = objects.find((o) => o.id === id);
  if (!object) return null;
  const siblings = objects.filter((o) => o.parentId === object.parentId);
  const at = siblings.findIndex((o) => o.id === id);
  return at >= 0 && at + 1 < siblings.length ? siblings[at + 1].id : null;
}
