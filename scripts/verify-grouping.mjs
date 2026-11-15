/**
 * Tests the pivot maths behind "group the selection", in
 * src/geometry/transforms.ts.
 *
 * The whole point of grouping from a selection is that the group's origin
 * lands at the centre of what you grouped. Get that wrong and rotating the
 * group swings the objects through an arc instead of spinning them in place,
 * which is exactly the failure that made people want a separate multi-object
 * gizmo in the first place.
 *
 * Run with:  npm run verify
 */

import {
  indexObjects,
  worldCentroid,
  worldOriginOf,
  worldToLocalPosition,
} from "../src/geometry/transforms.ts";

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name} :: ${err.message}`]);
  }
};

/** Float-tolerant compare: matrix round trips do not land on exact decimals. */
const near = (a, b, label, epsilon = 1e-9) => {
  const x = [a].flat();
  const y = [b].flat();
  if (x.length !== y.length) {
    throw new Error(`${label}: length ${x.length} vs ${y.length}`);
  }
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i] - y[i]) > epsilon) {
      throw new Error(
        `${label}: got [${x.join(", ")}], expected [${y.join(", ")}]`,
      );
    }
  }
};

const obj = (id, parentId, transform) => ({
  id,
  name: id,
  parentId,
  transform: {
    position: transform.position ?? [0, 0, 0],
    rotation: transform.rotation ?? [0, 0, 0],
    scale: transform.scale ?? [1, 1, 1],
  },
  geometry: { kind: "group" },
  materials: {},
  visible: true,
  locked: false,
});

const HALF_PI = Math.PI / 2;

/* ---- worldOriginOf ---------------------------------------------------- */

check("worldOriginOf: a root object reports its own position", () => {
  const objects = [obj("a", null, { position: [1, 2, 3] })];
  near(worldOriginOf("a", indexObjects(objects)), [1, 2, 3], "root");
});

check("worldOriginOf: a child accumulates its parent's translation", () => {
  const objects = [
    obj("p", null, { position: [10, 0, 0] }),
    obj("c", "p", { position: [1, 2, 3] }),
  ];
  near(worldOriginOf("c", indexObjects(objects)), [11, 2, 3], "child");
});

check("worldOriginOf: a child is affected by its parent's scale", () => {
  const objects = [
    obj("p", null, { scale: [2, 2, 2] }),
    obj("c", "p", { position: [1, 0, 0] }),
  ];
  near(worldOriginOf("c", indexObjects(objects)), [2, 0, 0], "scaled");
});

check("worldOriginOf: a child is affected by its parent's rotation", () => {
  // Quarter turn about Y sends +X to -Z.
  const objects = [
    obj("p", null, { rotation: [0, HALF_PI, 0] }),
    obj("c", "p", { position: [1, 0, 0] }),
  ];
  near(worldOriginOf("c", indexObjects(objects)), [0, 0, -1], "rotated", 1e-12);
});

/* ---- worldCentroid --------------------------------------------------- */

check("worldCentroid: one object is its own centre", () => {
  const objects = [obj("a", null, { position: [4, 5, 6] })];
  near(worldCentroid(["a"], indexObjects(objects)), [4, 5, 6], "single");
});

check("worldCentroid: two objects give the midpoint", () => {
  const objects = [
    obj("a", null, { position: [0, 0, 0] }),
    obj("b", null, { position: [10, 0, 0] }),
  ];
  near(worldCentroid(["a", "b"], indexObjects(objects)), [5, 0, 0], "midpoint");
});

check("worldCentroid: averages on every axis", () => {
  const objects = [
    obj("a", null, { position: [0, 0, 0] }),
    obj("b", null, { position: [3, 6, 9] }),
    obj("c", null, { position: [6, 12, 18] }),
  ];
  near(
    worldCentroid(["a", "b", "c"], indexObjects(objects)),
    [3, 6, 9],
    "three objects",
  );
});

check("worldCentroid: uses world positions, not local ones", () => {
  // Both children sit at local (1,0,0), but under parents 10 apart. The
  // centroid has to be 10.something, not 1 -- using local positions here
  // would put a new group's pivot in completely the wrong place.
  const objects = [
    obj("p1", null, { position: [0, 0, 0] }),
    obj("c1", "p1", { position: [1, 0, 0] }),
    obj("p2", null, { position: [20, 0, 0] }),
    obj("c2", "p2", { position: [1, 0, 0] }),
  ];
  near(
    worldCentroid(["c1", "c2"], indexObjects(objects)),
    [11, 0, 0],
    "world space",
  );
});

check("worldCentroid: an empty selection has no centre", () => {
  near(worldCentroid([], indexObjects([])), [0, 0, 0], "empty");
});

check("worldCentroid: ignores ids that are not in the scene", () => {
  const objects = [obj("a", null, { position: [2, 0, 0] })];
  // An unknown id contributes the origin rather than NaN, which would
  // poison every matrix downstream.
  const got = worldCentroid(["a", "ghost"], indexObjects(objects));
  if (got.some((n) => !Number.isFinite(n))) {
    throw new Error(`produced non-finite values: ${got}`);
  }
});

/* ---- worldToLocalPosition -------------------------------------------- */

check("worldToLocalPosition: at the top level it is a pass-through", () => {
  near(
    worldToLocalPosition([1, 2, 3], null, indexObjects([])),
    [1, 2, 3],
    "no parent",
  );
});

check("worldToLocalPosition: subtracts a parent's translation", () => {
  const objects = [obj("p", null, { position: [10, 0, 0] })];
  near(
    worldToLocalPosition([11, 2, 3], "p", indexObjects(objects)),
    [1, 2, 3],
    "translated parent",
  );
});

check("worldToLocalPosition: divides out a parent's scale", () => {
  const objects = [obj("p", null, { scale: [2, 4, 5] })];
  near(
    worldToLocalPosition([2, 4, 5], "p", indexObjects(objects)),
    [1, 1, 1],
    "scaled parent",
  );
});

check("worldToLocalPosition: inverts a parent's rotation", () => {
  const objects = [obj("p", null, { rotation: [0, HALF_PI, 0] })];
  near(
    worldToLocalPosition([0, 0, -1], "p", indexObjects(objects)),
    [1, 0, 0],
    "rotated parent",
    1e-12,
  );
});

check("worldToLocalPosition: round trips against worldOriginOf", () => {
  // The invariant that actually matters: for a child already parented, taking
  // its world origin back into the parent's space must return the local
  // position it is stored with -- whatever the parent's transform is.
  const local = [1.5, -2.25, 3.75];
  const objects = [
    obj("p", null, {
      position: [7, -3, 2],
      rotation: [0.3, -1.1, 0.7],
      scale: [2, 0.5, 1.5],
    }),
    obj("c", "p", { position: local }),
  ];
  const byId = indexObjects(objects);
  near(
    worldToLocalPosition(worldOriginOf("c", byId), "p", byId),
    local,
    "round trip",
    1e-9,
  );
});

check("worldToLocalPosition: round trips through nested parents", () => {
  const local = [0.5, 1.25, -2];
  const objects = [
    obj("a", null, { position: [1, 2, 3], rotation: [0, 0.4, 0] }),
    obj("b", "a", { position: [-4, 1, 0], scale: [3, 3, 3] }),
    obj("c", "b", { position: local }),
  ];
  const byId = indexObjects(objects);
  near(
    worldToLocalPosition(worldOriginOf("c", byId), "b", byId),
    local,
    "two levels",
    1e-9,
  );
});

/* ---- report ---------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
