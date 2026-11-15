/**
 * Verifies the reparenting maths in src/geometry/transforms.ts.
 *
 * The claim being tested: reparenting preserves WORLD transform. An object
 * dragged into a group should not visibly move, however the group is
 * positioned, rotated or scaled.
 *
 * Run with:  node scripts/verify-transforms.mjs
 *
 * This mirrors the logic in transforms.ts rather than importing it, since that
 * file is TypeScript. Keep the two in sync when the maths changes.
 */

import * as THREE from "three";

/* ---- mirrored from src/geometry/transforms.ts ---------------------- */

const indexObjects = (objects) => new Map(objects.map((o) => [o.id, o]));

function localMatrix(t) {
  const euler = new THREE.Euler(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ");
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t.position[0], t.position[1], t.position[2]),
    new THREE.Quaternion().setFromEuler(euler),
    new THREE.Vector3(t.scale[0], t.scale[1], t.scale[2]),
  );
}

function worldMatrix(id, byId) {
  const chain = [];
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  const out = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(localMatrix(chain[i].transform));
  return out;
}

function matrixToTransform(m) {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return { position: [p.x, p.y, p.z], rotation: [e.x, e.y, e.z], scale: [s.x, s.y, s.z] };
}

function localTransformUnderParent(id, newParentId, byId) {
  const world = worldMatrix(id, byId);
  const parentWorld = newParentId ? worldMatrix(newParentId, byId) : new THREE.Matrix4();
  return matrixToTransform(parentWorld.clone().invert().multiply(world));
}

function isDescendantOf(candidateId, ancestorId, byId) {
  const seen = new Set();
  let current = byId.get(candidateId);
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

function canReparent(id, newParentId, byId) {
  if (newParentId === null) return true;
  if (newParentId === id) return false;
  if (!byId.has(newParentId)) return false;
  return !isDescendantOf(newParentId, id, byId);
}

/* ---- the store action, in miniature -------------------------------- */

function setParent(objects, id, parentId) {
  const byId = indexObjects(objects);
  if (!canReparent(id, parentId, byId)) return objects;
  const transform = localTransformUnderParent(id, parentId, byId);
  return objects.map((o) => (o.id === id ? { ...o, parentId, transform } : o));
}

/* ---- harness -------------------------------------------------------- */

const results = [];
const EPS = 1e-6;

function check(name, fn) {
  try {
    fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name} :: ${err.message}`]);
  }
}

const t = (position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => ({
  position,
  rotation,
  scale,
});

const obj = (id, parentId, transform) => ({ id, parentId, transform });

/** Compares two matrices element by element. */
function expectSameMatrix(a, b, label) {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a.elements[i] - b.elements[i]) > EPS) {
      throw new Error(
        `${label}: element ${i} differs (${a.elements[i]} vs ${b.elements[i]})`,
      );
    }
  }
}

/** The core assertion: world matrix is identical before and after. */
function expectWorldPreserved(objects, id, newParentId, label) {
  const before = worldMatrix(id, indexObjects(objects));
  const after = worldMatrix(id, indexObjects(setParent(objects, id, newParentId)));
  expectSameMatrix(before, after, label);
}

const D90 = Math.PI / 2;
const D45 = Math.PI / 4;

/* ---- cases ---------------------------------------------------------- */

check("into a translated group", () => {
  const objects = [
    obj("g", null, t([5, 2, 0])),
    obj("box", null, t([3, 0, 0])),
  ];
  expectWorldPreserved(objects, "box", "g", "translate");
});

check("into a rotated group", () => {
  const objects = [
    obj("g", null, t([0, 0, 0], [0, D90, 0])),
    obj("box", null, t([3, 0, 0])),
  ];
  expectWorldPreserved(objects, "box", "g", "rotate");
});

check("into a scaled group", () => {
  const objects = [
    obj("g", null, t([0, 0, 0], [0, 0, 0], [2, 2, 2])),
    obj("box", null, t([3, 1, 0])),
  ];
  expectWorldPreserved(objects, "box", "g", "scale");
});

check("into a translated + rotated + scaled group", () => {
  const objects = [
    obj("g", null, t([5, 2, -3], [D45, D90, 0], [2, 2, 2])),
    obj("box", null, t([3, 1, 4], [0, D45, 0], [1.5, 1.5, 1.5])),
  ];
  expectWorldPreserved(objects, "box", "g", "full TRS");
});

check("out of a group, back to root", () => {
  const objects = [
    obj("g", null, t([5, 2, -3], [D45, D90, 0], [2, 2, 2])),
    obj("box", "g", t([1, 0, 0], [0, D45, 0])),
  ];
  expectWorldPreserved(objects, "box", null, "unparent");
});

check("between two different groups", () => {
  const objects = [
    obj("a", null, t([5, 0, 0], [0, D90, 0], [2, 2, 2])),
    obj("b", null, t([-4, 3, 1], [D45, 0, D45], [0.5, 0.5, 0.5])),
    obj("box", "a", t([1, 1, 1], [0, D45, 0])),
  ];
  expectWorldPreserved(objects, "box", "b", "regroup");
});

check("deeply nested chain preserved", () => {
  const objects = [
    obj("g1", null, t([2, 0, 0], [0, D45, 0], [2, 2, 2])),
    obj("g2", "g1", t([1, 1, 0], [D45, 0, 0])),
    obj("g3", "g2", t([0, 2, 1], [0, 0, D90], [0.5, 0.5, 0.5])),
    obj("box", "g3", t([1, 0, 0])),
    obj("target", null, t([-7, 1, 2], [0, D90, 0], [3, 3, 3])),
  ];
  expectWorldPreserved(objects, "box", "target", "deep chain");
});

check("subtree follows when its root is reparented", () => {
  const objects = [
    obj("g", null, t([1, 0, 0])),
    obj("child", "g", t([2, 0, 0])),
    obj("grandchild", "child", t([0, 3, 0])),
    obj("target", null, t([-5, 2, 1], [0, D90, 0], [2, 2, 2])),
  ];
  expectWorldPreserved(objects, "grandchild", null, "pre-check");
  const before = worldMatrix("grandchild", indexObjects(objects));
  const after = worldMatrix(
    "grandchild",
    indexObjects(setParent(objects, "g", "target")),
  );
  // The subtree SHOULD move: only the reparented object keeps its world
  // transform, its descendants ride along with it. Confirm it moved rather
  // than silently staying put, which would mean the hierarchy is not applying.
  let moved = false;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(before.elements[i] - after.elements[i]) > EPS) moved = true;
  }
  if (moved) throw new Error("grandchild moved — expected it to stay put");
});

check("refuses to parent to itself", () => {
  const byId = indexObjects([obj("a", null, t())]);
  if (canReparent("a", "a", byId)) throw new Error("allowed self-parenting");
});

check("refuses to parent to its own descendant", () => {
  const objects = [
    obj("a", null, t()),
    obj("b", "a", t()),
    obj("c", "b", t()),
  ];
  const byId = indexObjects(objects);
  if (canReparent("a", "c", byId)) throw new Error("allowed a cycle");
  if (!canReparent("c", null, byId)) throw new Error("blocked a legal unparent");
});

check("survives a pre-existing cycle without hanging", () => {
  // Not reachable through the UI, but a hand-edited scene file could do it.
  const objects = [obj("a", "b", t([1, 0, 0])), obj("b", "a", t([0, 1, 0]))];
  worldMatrix("a", indexObjects(objects));
});

/* ---- report --------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
