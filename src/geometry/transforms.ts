import * as THREE from "three";
import type { SceneObject, Transform, Vec3 } from "../types/scene";

/**
 * Transform maths for the hierarchy.
 *
 * These work off the store's flat object list rather than the live Three.js
 * scene graph, because reparenting happens inside a store action -- outside
 * React, and potentially before the renderer has caught up. The store is the
 * source of truth; the scene graph is a projection of it.
 */

export type ObjectIndex = Map<string, SceneObject>;

export function indexObjects(objects: SceneObject[]): ObjectIndex {
  return new Map(objects.map((o) => [o.id, o]));
}

/** Composes one object's own transform into a matrix. */
export function localMatrix(t: Transform): THREE.Matrix4 {
  const euler = new THREE.Euler(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ");
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t.position[0], t.position[1], t.position[2]),
    new THREE.Quaternion().setFromEuler(euler),
    new THREE.Vector3(t.scale[0], t.scale[1], t.scale[2]),
  );
}

/**
 * Walks up the parent chain and composes the full world matrix.
 *
 * The `seen` set is cheap insurance: a cycle in parentId would otherwise spin
 * forever. setParent refuses to create one, but a hand-edited scene file
 * could.
 */
export function worldMatrix(id: string, byId: ObjectIndex): THREE.Matrix4 {
  const chain: SceneObject[] = [];
  const seen = new Set<string>();

  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  // Root-most first, so each multiply applies the next level down.
  const out = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) {
    out.multiply(localMatrix(chain[i].transform));
  }
  return out;
}

/** Decomposes a matrix back into the store's transform shape. */
export function matrixToTransform(m: THREE.Matrix4): Transform {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, quaternion, scale);

  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    position: [position.x, position.y, position.z] as Vec3,
    rotation: [euler.x, euler.y, euler.z] as Vec3,
    scale: [scale.x, scale.y, scale.z] as Vec3,
  };
}

/**
 * The local transform `id` would need under `newParentId` to stay exactly
 * where it currently sits in world space.
 *
 *     newLocal = inverse(parentWorld) * currentWorld
 */
export function localTransformUnderParent(
  id: string,
  newParentId: string | null,
  byId: ObjectIndex,
): Transform {
  const world = worldMatrix(id, byId);
  const parentWorld = newParentId
    ? worldMatrix(newParentId, byId)
    : new THREE.Matrix4();

  const newLocal = parentWorld.clone().invert().multiply(world);
  return matrixToTransform(newLocal);
}

/** World-space origin of an object, i.e. the translation of its world matrix. */
export function worldOriginOf(id: string, byId: ObjectIndex): Vec3 {
  const e = worldMatrix(id, byId).elements;
  return [e[12], e[13], e[14]];
}

/**
 * Average of the world-space origins of several objects.
 *
 * This is where a new group's pivot goes. Origins rather than bounding-box
 * centres: every primitive is built centred on its own origin, so the two
 * agree for a single object, and averaging origins needs no geometry
 * evaluation -- which keeps this a pure function over the store's data,
 * testable without a renderer.
 */
export function worldCentroid(
  ids: readonly string[],
  byId: ObjectIndex,
): Vec3 {
  if (ids.length === 0) return [0, 0, 0];

  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of ids) {
    const [ox, oy, oz] = worldOriginOf(id, byId);
    x += ox;
    y += oy;
    z += oz;
  }
  return [x / ids.length, y / ids.length, z / ids.length];
}

/**
 * The local position an object needs under `parentId` to sit at `world`.
 *
 * Used when a new group is created inside an existing one: the pivot is
 * computed in world space, but the group is stored with a local transform.
 */
export function worldToLocalPosition(
  world: Vec3,
  parentId: string | null,
  byId: ObjectIndex,
): Vec3 {
  if (!parentId) return [...world];

  // worldMatrix returns a fresh matrix, so inverting it in place is safe.
  const inverse = worldMatrix(parentId, byId).invert();
  const local = new THREE.Vector3(world[0], world[1], world[2]).applyMatrix4(
    inverse,
  );
  return [local.x, local.y, local.z];
}

/** True when `candidateId` sits somewhere beneath `ancestorId`. */
export function isDescendantOf(
  candidateId: string,
  ancestorId: string,
  byId: ObjectIndex,
): boolean {
  const seen = new Set<string>();
  let current = byId.get(candidateId);

  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/**
 * Whether `id` may be reparented under `newParentId`.
 *
 * Refuses self-parenting and cycles. Shared by the store action and the
 * outliner's drop targets, so the UI never offers a drop the store would
 * silently reject.
 */
export function canReparent(
  id: string,
  newParentId: string | null,
  byId: ObjectIndex,
): boolean {
  if (newParentId === null) return true;
  if (newParentId === id) return false;
  if (!byId.has(newParentId)) return false;
  return !isDescendantOf(newParentId, id, byId);
}

/** Groups objects by parentId for recursive rendering. Key null = root. */
export function childrenByParent(
  objects: SceneObject[],
): Map<string | null, SceneObject[]> {
  const map = new Map<string | null, SceneObject[]>();
  for (const o of objects) {
    const list = map.get(o.parentId);
    if (list) list.push(o);
    else map.set(o.parentId, [o]);
  }
  return map;
}
