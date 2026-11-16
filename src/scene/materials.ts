import type { FaceMaterial, SceneObject, TextureAsset } from "../types/scene";
import { DEFAULT_MATERIAL, getGroupCount } from "../types/scene";
import { subtreeIds, uniqueName } from "./hierarchy";

/**
 * Material and texture-asset logic, as pure functions over scene data.
 *
 * Separated from sceneStore for the same reason hierarchy.ts and selection.ts
 * are: the store is the React-coupled layer and cannot be imported in plain
 * Node (devFreeze reads import.meta.env), so anything worth testing has to
 * live somewhere a harness can reach. Everything here takes arrays and returns
 * new ones, and the store is left holding only the decision of when to call it
 * and what to record on the undo stack.
 *
 * Every function returns the SAME object reference when nothing changed. That
 * is load-bearing twice over: history snapshots share structure with the live
 * document, and the store uses reference equality to decide whether an edit
 * happened at all, so a no-op must not push an undo entry.
 */

/* ------------------------------------------------------------------ */
/* Texture assets                                                      */
/* ------------------------------------------------------------------ */

export interface TextureImport {
  name: string;
  path: string;
}

export interface ImportResult {
  /** Assets that did not already exist, in import order. */
  added: TextureAsset[];
  /** One id per requested entry, existing or new, in the order given. */
  ids: string[];
}

/**
 * Works out which of a batch of imports are actually new.
 *
 * A path already in the scene yields the existing asset's id rather than a
 * second copy: two tray tiles of the same brick, with separate names and
 * separate edits, is confusion rather than a feature. Names are deduplicated
 * against the imports earlier in the SAME batch as well as the existing ones,
 * so picking three files called "wall" does not produce three assets named
 * "wall".
 *
 * `makeId` is injected rather than called directly so tests can produce
 * predictable ids, matching duplicateSubtree in hierarchy.ts.
 */
export function resolveTextureImports(
  existing: readonly TextureAsset[],
  entries: readonly TextureImport[],
  makeId: () => string,
): ImportResult {
  const idByPath = new Map(existing.map((t) => [t.path, t.id]));
  const taken = existing.map((t) => t.name);

  const added: TextureAsset[] = [];
  const ids: string[] = [];

  for (const entry of entries) {
    const already = idByPath.get(entry.path);
    if (already) {
      ids.push(already);
      continue;
    }

    const asset: TextureAsset = {
      id: makeId(),
      name: uniqueName(entry.name, taken),
      path: entry.path,
    };

    idByPath.set(asset.path, asset.id);
    taken.push(asset.name);
    added.push(asset);
    ids.push(asset.id);
  }

  return { added, ids };
}

/**
 * Clears every material slot pointing at a texture that is going away.
 *
 * Not optional housekeeping. A slot referencing an asset that is gone draws
 * untextured, which looks like it worked, and then saves a dangling id the
 * loader has to repair on the way back in. Removing the asset and its
 * references together keeps the document internally consistent at every point
 * in the undo stack.
 */
export function clearTextureReferences(
  objects: readonly SceneObject[],
  textureId: string,
): SceneObject[] | readonly SceneObject[] {
  let changed = false;

  const next = objects.map((object) => {
    const slots = Object.entries(object.materials);
    if (!slots.some(([, m]) => m.textureId === textureId)) return object;

    changed = true;
    const materials: Record<number, FaceMaterial> = {};
    for (const [slot, m] of slots) {
      materials[Number(slot)] =
        m.textureId === textureId ? { ...m, textureId: null } : m;
    }
    return { ...object, materials };
  });

  return changed ? next : objects;
}

/* ------------------------------------------------------------------ */
/* Material slots                                                      */
/* ------------------------------------------------------------------ */

/**
 * Patches one material slot of one object.
 *
 * A slot with no entry yet falls back to DEFAULT_MATERIAL rather than being
 * skipped, so patching a face of a geometry whose slot map is sparse still
 * produces a complete, editable entry instead of a half-populated one.
 */
export function patchFaceMaterial(
  objects: readonly SceneObject[],
  id: string,
  slot: number,
  patch: Partial<FaceMaterial>,
): SceneObject[] | readonly SceneObject[] {
  let changed = false;

  const next = objects.map((object) => {
    if (object.id !== id) return object;
    changed = true;
    const current = object.materials[slot] ?? DEFAULT_MATERIAL;
    return {
      ...object,
      materials: { ...object.materials, [slot]: { ...current, ...patch } },
    };
  });

  return changed ? next : objects;
}

/**
 * Every object a material patch aimed at `ids` should actually reach.
 *
 * Expanded through subtrees, not just the listed ids, because a viewport click
 * on a grouped object selects the GROUP, and a group has no material slots of
 * its own. If assignment stopped at the selection, clicking a wall of a
 * grouped building and picking a texture would appear to do nothing at all.
 * Reaching one face of a grouped object is what the outliner and the per-face
 * controls are for.
 *
 * Groups themselves are excluded from the result: they carry a transform and
 * nothing else, and their children are already in the set.
 */
export function materialTargets(
  objects: readonly SceneObject[],
  ids: readonly string[],
): Set<string> {
  const mutable = objects as SceneObject[];
  const reached = new Set<string>();

  for (const id of ids) {
    for (const member of subtreeIds(mutable, id)) reached.add(member);
  }

  const targets = new Set<string>();
  for (const object of objects) {
    if (!reached.has(object.id)) continue;
    if (object.geometry.kind === "group") continue;
    targets.add(object.id);
  }

  return targets;
}

/**
 * Patches every material slot of every mesh in the given subtrees.
 *
 * Writes a complete slot map rather than merging into whatever was there, so
 * an object whose slots were sparse comes out of a whole-object assignment
 * with every face explicitly set.
 */
export function patchMaterialsMany(
  objects: readonly SceneObject[],
  ids: readonly string[],
  patch: Partial<FaceMaterial>,
): SceneObject[] | readonly SceneObject[] {
  const targets = materialTargets(objects, ids);
  if (targets.size === 0) return objects;

  return objects.map((object) => {
    if (!targets.has(object.id)) return object;

    const count = getGroupCount(object.geometry);
    const materials: Record<number, FaceMaterial> = {};
    for (let i = 0; i < count; i++) {
      materials[i] = { ...(object.materials[i] ?? DEFAULT_MATERIAL), ...patch };
    }
    return { ...object, materials };
  });
}
