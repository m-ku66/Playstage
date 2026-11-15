/**
 * Tests the real selection rules in src/scene/selection.ts.
 *
 * These decide what a click means, so they are worth pinning down directly
 * rather than through a renderer:
 *
 *   - outermostAncestorId is what makes a grouped member unselectable in the
 *     viewport: a click on a wall resolves to the building.
 *   - topmostIds is what stops a batch operation double-counting. Duplicating
 *     a group and one of its own children while both are selected would copy
 *     that child twice without it.
 *
 * Run with:  npm run verify
 */

import {
  outermostAncestorId,
  topmostIds,
  toggleId,
} from "../src/scene/selection.ts";
import { indexObjects } from "../src/geometry/transforms.ts";

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

/** Minimal object; only id and parentId matter to these rules. */
const obj = (id, parentId = null) => ({ id, name: id, parentId });

/* ---- outermostAncestorId --------------------------------------------- */

check("outermostAncestorId: a top-level object is its own pick target", () => {
  const objects = [obj("a")];
  eq(outermostAncestorId(indexObjects(objects), "a"), "a", "self");
});

check("outermostAncestorId: a group member resolves to the group", () => {
  const objects = [obj("g"), obj("wall", "g")];
  eq(outermostAncestorId(indexObjects(objects), "wall"), "g", "one level up");
});

check("outermostAncestorId: resolves through nested groups to the top", () => {
  const objects = [
    obj("building"),
    obj("floor", "building"),
    obj("room", "floor"),
    obj("lamp", "room"),
  ];
  const byId = indexObjects(objects);
  eq(outermostAncestorId(byId, "lamp"), "building", "three levels up");
  eq(outermostAncestorId(byId, "room"), "building", "two levels up");
  eq(outermostAncestorId(byId, "building"), "building", "already the root");
});

check("outermostAncestorId: stops at a parent missing from the list", () => {
  // Shouldn't happen -- the loader reparents orphans -- but a click must not
  // return something that isn't there.
  const objects = [obj("child", "ghost")];
  eq(outermostAncestorId(indexObjects(objects), "child"), "child", "stops");
});

check("outermostAncestorId: returns the id for an unknown object", () => {
  eq(outermostAncestorId(indexObjects([]), "nope"), "nope", "unknown id");
});

check("outermostAncestorId: terminates on a parent cycle", () => {
  // A hang here would freeze the app on a single click, so this is guarded
  // even though the loader breaks cycles on the way in.
  const objects = [obj("a", "b"), obj("b", "a")];
  const got = outermostAncestorId(indexObjects(objects), "a");
  if (got !== "a" && got !== "b") throw new Error(`returned ${got}`);
});

check("outermostAncestorId: terminates on a self-parent", () => {
  const objects = [obj("a", "a")];
  eq(outermostAncestorId(indexObjects(objects), "a"), "a", "self loop");
});

/* ---- topmostIds ------------------------------------------------------- */

check("topmostIds: drops an id that has a selected ancestor", () => {
  const objects = [obj("g"), obj("child", "g")];
  eq(topmostIds(objects, ["g", "child"]), ["g"], "child dropped");
});

check("topmostIds: keeps a child whose parent is not selected", () => {
  const objects = [obj("g"), obj("child", "g")];
  eq(topmostIds(objects, ["child"]), ["child"], "kept");
});

check("topmostIds: drops a deep descendant, not just a direct child", () => {
  const objects = [obj("a"), obj("b", "a"), obj("c", "b"), obj("d", "c")];
  eq(topmostIds(objects, ["a", "d"]), ["a"], "grandchild dropped");
});

check("topmostIds: keeps unrelated siblings", () => {
  const objects = [obj("a"), obj("b"), obj("c")];
  eq(topmostIds(objects, ["a", "c"]), ["a", "c"], "both kept");
});

check("topmostIds: returns scene order, not click order", () => {
  const objects = [obj("a"), obj("b"), obj("c")];
  eq(topmostIds(objects, ["c", "a", "b"]), ["a", "b", "c"], "sorted by list");
});

check("topmostIds: keeps the shallowest of several selected levels", () => {
  const objects = [obj("a"), obj("b", "a"), obj("c", "b")];
  eq(topmostIds(objects, ["b", "c"]), ["b"], "b is the root of the selection");
});

check("topmostIds: empty selection gives an empty result", () => {
  eq(topmostIds([obj("a")], []), [], "empty");
});

check("topmostIds: ignores ids that are not in the scene", () => {
  eq(topmostIds([obj("a")], ["a", "ghost"]), ["a"], "ghost ignored");
});

check("topmostIds: terminates on a parent cycle", () => {
  const objects = [obj("a", "b"), obj("b", "a")];
  const got = topmostIds(objects, ["a", "b"]);
  if (got.length > 2) throw new Error(`returned ${JSON.stringify(got)}`);
});

/* ---- toggleId --------------------------------------------------------- */

check("toggleId: adds an id that is not selected", () => {
  eq(toggleId([], "a"), ["a"], "first");
  eq(toggleId(["a"], "b"), ["a", "b"], "appended");
});

check("toggleId: removes an id that is selected", () => {
  eq(toggleId(["a", "b"], "a"), ["b"], "removed from the front");
  eq(toggleId(["a", "b"], "b"), ["a"], "removed from the end");
});

check("toggleId: the last entry is the active object", () => {
  // Removing then re-adding moves it to the end, making it active.
  const once = toggleId(["a", "b", "c"], "a");
  eq(once, ["b", "c"], "a removed");
  eq(toggleId(once, "a"), ["b", "c", "a"], "a is now last");
});

check("toggleId: does not mutate its input", () => {
  const input = ["a"];
  toggleId(input, "b");
  eq(input, ["a"], "input untouched");
});

/* ---- report ---------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
