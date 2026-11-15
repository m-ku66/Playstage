/**
 * Tests the real hierarchy operations in src/scene/hierarchy.ts.
 *
 * Unlike the other harnesses, this imports the actual source rather than
 * mirroring it — Node can strip TypeScript types directly, so there is no
 * copy to drift out of sync with.
 *
 * Run with:  node --experimental-strip-types scripts/verify-hierarchy.mjs
 * Or:        npm run verify
 */

import {
  duplicateSubtree,
  insertAfter,
  nextSiblingId,
  placeInOrder,
  subtreeIds,
  uniqueName,
} from "../src/scene/hierarchy.ts";

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name} :: ${err.message}`]);
  }
};
const eq = (a, b, label) => {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  if (x !== y) throw new Error(`${label}: got ${x}, expected ${y}`);
};

/** Minimal object; only the fields these operations touch matter. */
const obj = (id, parentId = null, name = id) => ({
  id,
  name,
  parentId,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  geometry: { kind: "primitive", primitive: "box", params: { width: 1 } },
  materials: {},
  visible: true,
  locked: false,
});

/** Deterministic ids so assertions can name them. */
const counter = () => {
  let n = 0;
  return () => `copy${++n}`;
};

const order = (list) => list.map((o) => o.id);
const parents = (list) =>
  Object.fromEntries(list.map((o) => [o.id, o.parentId]));

/* ---- subtreeIds ----------------------------------------------------- */

check("subtreeIds: leaf is just itself", () => {
  const objects = [obj("a"), obj("b")];
  eq([...subtreeIds(objects, "a")], ["a"], "leaf");
});

check("subtreeIds: collects grandchildren", () => {
  const objects = [obj("g"), obj("c", "g"), obj("gc", "c"), obj("other")];
  eq([...subtreeIds(objects, "g")].sort(), ["c", "g", "gc"], "deep");
});

/* ---- duplicateSubtree ----------------------------------------------- */

check("duplicate: a lone object copies alone", () => {
  const objects = [obj("a"), obj("b")];
  const { copies, rootCopyId } = duplicateSubtree(objects, "a", counter());
  eq(copies.length, 1, "count");
  eq(rootCopyId, "copy1", "root id");
  eq(copies[0].parentId, null, "keeps parent");
});

check("duplicate: a group brings its children — the reported bug", () => {
  const objects = [obj("g"), obj("c1", "g"), obj("c2", "g")];
  const { copies, rootCopyId } = duplicateSubtree(objects, "g", counter());
  eq(copies.length, 3, "copied object count");
  const kids = copies.filter((o) => o.parentId === rootCopyId);
  eq(kids.length, 2, "children reparented onto the copy");
});

check("duplicate: internal links point at copies, never originals", () => {
  const objects = [obj("g"), obj("c", "g"), obj("gc", "c")];
  const { copies } = duplicateSubtree(objects, "g", counter());
  const newIds = new Set(copies.map((o) => o.id));
  for (const c of copies) {
    if (c.parentId !== null && !newIds.has(c.parentId)) {
      throw new Error(`${c.id} still points at original ${c.parentId}`);
    }
  }
});

check("duplicate: nesting depth is preserved", () => {
  const objects = [obj("g"), obj("c", "g"), obj("gc", "c")];
  const { copies, rootCopyId } = duplicateSubtree(objects, "g", counter());
  const byId = new Map(copies.map((o) => [o.id, o]));
  const depth = (id) => {
    let d = 0;
    let cur = byId.get(id);
    while (cur?.parentId && byId.has(cur.parentId)) {
      d++;
      cur = byId.get(cur.parentId);
    }
    return d;
  };
  const leaf = copies.find((o) => !copies.some((x) => x.parentId === o.id));
  eq(depth(leaf.id), 2, "grandchild depth");
  eq(byId.get(rootCopyId).parentId, null, "root copy at top level");
});

check("duplicate: a nested group keeps its own parent", () => {
  const objects = [obj("outer"), obj("inner", "outer"), obj("leaf", "inner")];
  const { copies, rootCopyId } = duplicateSubtree(objects, "inner", counter());
  const rootCopy = copies.find((o) => o.id === rootCopyId);
  eq(rootCopy.parentId, "outer", "copy sits beside the original");
});

check("duplicate: names stay unique", () => {
  const objects = [obj("g", null, "Group"), obj("c", "g", "Box")];
  const { copies } = duplicateSubtree(objects, "g", counter());
  const all = [...objects.map((o) => o.name), ...copies.map((o) => o.name)];
  eq(new Set(all).size, all.length, "no duplicate names");
});

check("duplicate: unknown id returns null", () => {
  if (duplicateSubtree([obj("a")], "nope", counter()) !== null) {
    throw new Error("expected null");
  }
});

/* ---- insertAfter ---------------------------------------------------- */

check("insertAfter: copies land beside the source, not at the end", () => {
  const objects = [obj("a"), obj("b"), obj("c")];
  const out = insertAfter(objects, "a", [obj("a2")]);
  eq(order(out), ["a", "a2", "b", "c"], "position");
});

/* ---- placeInOrder --------------------------------------------------- */

check("reorder: move before an earlier sibling", () => {
  const objects = [obj("a"), obj("b"), obj("c")];
  const moved = { ...objects[2] };
  eq(order(placeInOrder(objects, moved, "a")), ["c", "a", "b"], "to front");
});

check("reorder: move to the end of its parent", () => {
  const objects = [obj("a"), obj("b"), obj("c")];
  const moved = { ...objects[0] };
  eq(order(placeInOrder(objects, moved, null)), ["b", "c", "a"], "to back");
});

check("reorder: stays within its own parent's children", () => {
  const objects = [obj("g"), obj("c1", "g"), obj("c2", "g"), obj("root2")];
  const moved = { ...objects[2] };
  const out = placeInOrder(objects, moved, "c1");
  const kids = out.filter((o) => o.parentId === "g").map((o) => o.id);
  eq(kids, ["c2", "c1"], "sibling order swapped");
});

check("reorder: reparenting to a group appends to its children", () => {
  const objects = [obj("g"), obj("c1", "g"), obj("loose")];
  const moved = { ...objects[2], parentId: "g" };
  const out = placeInOrder(objects, moved, null);
  const kids = out.filter((o) => o.parentId === "g").map((o) => o.id);
  eq(kids, ["c1", "loose"], "appended last");
});

check("reorder: moving to an empty group still lands in the list", () => {
  const objects = [obj("g"), obj("loose")];
  const moved = { ...objects[1], parentId: "g" };
  const out = placeInOrder(objects, moved, null);
  eq(out.length, 2, "nothing lost");
  eq(parents(out).loose, "g", "reparented");
});

check("reorder: never duplicates or drops the moved object", () => {
  const objects = [obj("a"), obj("b"), obj("c"), obj("d")];
  for (const before of ["a", "b", "c", "d", null]) {
    const moved = { ...objects[1] };
    const out = placeInOrder(objects, moved, before);
    eq(out.length, 4, `length with before=${before}`);
    eq(out.filter((o) => o.id === "b").length, 1, `single b, before=${before}`);
  }
});

/* ---- nextSiblingId --------------------------------------------------- */

check("nextSiblingId: returns the following sibling", () => {
  const objects = [obj("a"), obj("b"), obj("c")];
  eq(nextSiblingId(objects, "a"), "b", "middle");
  eq(nextSiblingId(objects, "c"), null, "last");
});

check("nextSiblingId: ignores objects under other parents", () => {
  const objects = [obj("g"), obj("c1", "g"), obj("root2"), obj("c2", "g")];
  eq(nextSiblingId(objects, "c1"), "c2", "skips root2");
});

/* ---- uniqueName ------------------------------------------------------ */

check("uniqueName: increments past collisions", () => {
  eq(uniqueName("Box", []), "Box", "free");
  eq(uniqueName("Box", ["Box"]), "Box 2", "one taken");
  eq(uniqueName("Box", ["Box", "Box 2"]), "Box 3", "two taken");
});

/* ---- report ---------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
