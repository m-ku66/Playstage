/**
 * Tests the material and texture-asset logic in src/scene/materials.ts, plus
 * the scene file round trip for textures.
 *
 * Why these cases: the two failures that would hurt most here are silent ones.
 * A material patch that misses the meshes inside a group looks like a broken
 * feature (you click a texture and nothing happens). A texture removal that
 * leaves references behind looks like it worked, and only shows up later as a
 * dangling id the loader has to repair. Both are covered below.
 *
 * The reference-equality cases matter as much as the behavioural ones. The
 * store decides whether to push an undo entry by comparing the returned array
 * against the one it passed in, so a helper that returns a fresh array after
 * changing nothing would spend a Ctrl+Z press on a no-op.
 *
 * Run with:  npm run verify
 */

import {
  clearTextureReferences,
  materialTargets,
  patchFaceMaterial,
  patchMaterialsMany,
  resolveTextureImports,
} from "../src/scene/materials.ts";
import {
  DEFAULT_MATERIAL,
  PRIMITIVE_GROUP_COUNT,
  slotLabels,
} from "../src/types/scene.ts";
import { parseSceneFile, serializeScene } from "../src/io/sceneFile.ts";

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name} :: ${err.message}`]);
  }
};

const eq = (got, want, label) => {
  if (got !== want) {
    throw new Error(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
};

const ok = (value, label) => {
  if (!value) throw new Error(label);
};

/** Sequential ids, so expectations can name them. */
const counter = () => {
  let n = 0;
  return () => `t${++n}`;
};

const box = (id, parentId = null, materials = {}) => ({
  id,
  name: id,
  parentId,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  geometry: { kind: "primitive", primitive: "box", params: { width: 1, height: 1, depth: 1 } },
  materials,
  visible: true,
  locked: false,
});

const group = (id, parentId = null) => ({
  id,
  name: id,
  parentId,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  geometry: { kind: "group" },
  materials: {},
  visible: true,
  locked: false,
});

const face = (patch = {}) => ({ ...DEFAULT_MATERIAL, ...patch });

/* ---- texture imports -------------------------------------------------- */

check("imports each new path once, in order", () => {
  const { added, ids } = resolveTextureImports(
    [],
    [
      { name: "brick", path: "/a/brick.png" },
      { name: "road", path: "/a/road.png" },
    ],
    counter(),
  );
  eq(added.length, 2, "two added");
  eq(ids.join(","), "t1,t2", "ids in order");
  eq(added[0].path, "/a/brick.png", "first path kept");
});

check("re-importing a path returns the existing asset instead of a copy", () => {
  const existing = [{ id: "old", name: "brick", path: "/a/brick.png" }];
  const { added, ids } = resolveTextureImports(
    existing,
    [{ name: "brick", path: "/a/brick.png" }],
    counter(),
  );
  eq(added.length, 0, "nothing added");
  eq(ids[0], "old", "existing id returned");
});

check("deduplicates names against the same batch, not just the scene", () => {
  const { added } = resolveTextureImports(
    [],
    [
      { name: "wall", path: "/a/wall.png" },
      { name: "wall", path: "/b/wall.png" },
      { name: "wall", path: "/c/wall.png" },
    ],
    counter(),
  );
  const names = new Set(added.map((t) => t.name));
  eq(names.size, 3, "three distinct names");
});

check("a duplicate path inside one batch collapses to one asset", () => {
  const { added, ids } = resolveTextureImports(
    [],
    [
      { name: "brick", path: "/a/brick.png" },
      { name: "brick", path: "/a/brick.png" },
    ],
    counter(),
  );
  eq(added.length, 1, "one asset");
  eq(ids[0], ids[1], "both entries point at it");
});

/* ---- removing a texture ----------------------------------------------- */

check("clears every slot referencing a removed texture", () => {
  const objects = [
    box("a", null, { 0: face({ textureId: "x" }), 1: face({ textureId: "y" }) }),
    box("b", null, { 0: face({ textureId: "x" }) }),
  ];
  const next = clearTextureReferences(objects, "x");

  eq(next[0].materials[0].textureId, null, "a slot 0 cleared");
  eq(next[0].materials[1].textureId, "y", "a slot 1 untouched");
  eq(next[1].materials[0].textureId, null, "b slot 0 cleared");
});

check("clearing preserves the rest of a face material", () => {
  const objects = [
    box("a", null, { 0: face({ textureId: "x", color: "#ff0000", tiling: [3, 3] }) }),
  ];
  const next = clearTextureReferences(objects, "x");
  eq(next[0].materials[0].color, "#ff0000", "colour kept");
  eq(next[0].materials[0].tiling[0], 3, "tiling kept");
});

check("clearing an unreferenced texture returns the SAME array", () => {
  const objects = [box("a", null, { 0: face({ textureId: "y" }) })];
  ok(clearTextureReferences(objects, "x") === objects, "identity preserved");
});

check("untouched objects keep their identity when another changes", () => {
  const objects = [
    box("a", null, { 0: face({ textureId: "x" }) }),
    box("b", null, { 0: face({ textureId: "y" }) }),
  ];
  const next = clearTextureReferences(objects, "x");
  ok(next[1] === objects[1], "b not rebuilt");
  ok(next[0] !== objects[0], "a rebuilt");
});

/* ---- targeting -------------------------------------------------------- */

check("a group target reaches the meshes inside it, not the group", () => {
  const objects = [group("g"), box("a", "g"), box("b", "g")];
  const targets = materialTargets(objects, ["g"]);

  eq(targets.size, 2, "two meshes");
  ok(targets.has("a") && targets.has("b"), "both children");
  ok(!targets.has("g"), "group itself excluded");
});

check("targeting reaches arbitrarily deep", () => {
  const objects = [group("g"), group("h", "g"), box("deep", "h")];
  ok(materialTargets(objects, ["g"]).has("deep"), "nested mesh reached");
});

check("overlapping targets collapse", () => {
  const objects = [group("g"), box("a", "g")];
  eq(materialTargets(objects, ["g", "a"]).size, 1, "one target");
});

check("a selection of only empty groups has no targets", () => {
  const objects = [group("g")];
  eq(materialTargets(objects, ["g"]).size, 0, "nothing to patch");
});

/* ---- patching many --------------------------------------------------- */

check("whole-object assignment fills every slot of a box", () => {
  const objects = [box("a")];
  const next = patchMaterialsMany(objects, ["a"], { textureId: "x" });

  eq(Object.keys(next[0].materials).length, 6, "six slots");
  for (let i = 0; i < 6; i++) {
    eq(next[0].materials[i].textureId, "x", `slot ${i} set`);
  }
});

check("assignment through a group textures its children", () => {
  const objects = [group("g"), box("a", "g")];
  const next = patchMaterialsMany(objects, ["g"], { textureId: "x" });

  const child = next.find((o) => o.id === "a");
  eq(child.materials[0].textureId, "x", "child textured");
  eq(Object.keys(next.find((o) => o.id === "g").materials).length, 0, "group untouched");
});

check("a patch over only empty groups returns the SAME array", () => {
  const objects = [group("g")];
  ok(patchMaterialsMany(objects, ["g"], { textureId: "x" }) === objects, "no-op");
});

check("patching fills sparse slots from the default rather than leaving holes", () => {
  const objects = [box("a", null, { 2: face({ color: "#123456" }) })];
  const next = patchMaterialsMany(objects, ["a"], { textureId: "x" });

  eq(next[0].materials[2].color, "#123456", "existing slot's colour survives");
  eq(next[0].materials[0].color, DEFAULT_MATERIAL.color, "absent slot defaulted");
  eq(next[0].materials[5].textureId, "x", "every slot got the patch");
});

/* ---- patching one face ----------------------------------------------- */

check("patching one slot leaves the others alone", () => {
  const objects = [box("a", null, { 0: face({ color: "#aaaaaa" }), 1: face() })];
  const next = patchFaceMaterial(objects, "a", 1, { tiling: [4, 2] });

  eq(next[0].materials[1].tiling[1], 2, "slot 1 patched");
  eq(next[0].materials[0].color, "#aaaaaa", "slot 0 untouched");
});

check("patching an absent slot builds it from the default", () => {
  const objects = [box("a")];
  const next = patchFaceMaterial(objects, "a", 3, { rotation: 1.5 });

  eq(next[0].materials[3].rotation, 1.5, "patch applied");
  eq(next[0].materials[3].color, DEFAULT_MATERIAL.color, "rest defaulted");
});

check("patching an id that is not there returns the SAME array", () => {
  const objects = [box("a")];
  ok(patchFaceMaterial(objects, "nope", 0, { rotation: 1 }) === objects, "no-op");
});

/* ---- slot labels ------------------------------------------------------ */

check("every primitive has exactly one label per material group", () => {
  for (const [kind, count] of Object.entries(PRIMITIVE_GROUP_COUNT)) {
    const labels = slotLabels({ kind: "primitive", primitive: kind, params: {} });
    eq(labels.length, count, `${kind} label count`);
  }
});

check("slot labels are distinct within a primitive", () => {
  for (const kind of Object.keys(PRIMITIVE_GROUP_COUNT)) {
    const labels = slotLabels({ kind: "primitive", primitive: kind, params: {} });
    eq(new Set(labels).size, labels.length, `${kind} labels unique`);
  }
});

check("a group has no slots to label", () => {
  eq(slotLabels({ kind: "group" }).length, 0, "no labels");
});

check("generated geometry gets numbered placeholders", () => {
  const labels = slotLabels({ kind: "lathe", profile: [], segments: 8, phiLength: 1 });
  eq(labels.length, 1, "one slot until phase 04 tracks them");
  eq(labels[0], "Slot 1", "numbered rather than guessed");
});

/* ---- scene file round trip ------------------------------------------- */

check("textures and their references survive a save/load round trip", () => {
  const file = {
    format: "playstage-scene",
    version: 1,
    name: "Street",
    objects: [
      box("a", null, {
        0: face({ textureId: "x", tiling: [3, 1.5], offset: [0.25, 0], rotation: 0.5, doubleSided: true }),
      }),
    ],
    hotspots: [],
    textures: [{ id: "x", name: "Brick", path: "/a/brick.png" }],
  };

  const out = parseSceneFile(serializeScene(file)).file;

  eq(out.textures.length, 1, "asset kept");
  eq(out.textures[0].path, "/a/brick.png", "path kept");

  const slot = out.objects[0].materials[0];
  eq(slot.textureId, "x", "reference kept");
  eq(slot.tiling[0], 3, "tiling x kept");
  eq(slot.tiling[1], 1.5, "tiling y kept");
  eq(slot.offset[0], 0.25, "offset kept");
  eq(slot.rotation, 0.5, "rotation kept");
  eq(slot.doubleSided, true, "doubleSided kept");
});

check("a texture asset written without a path still loads", () => {
  const out = parseSceneFile(
    JSON.stringify({
      format: "playstage-scene",
      version: 1,
      name: "S",
      objects: [],
      hotspots: [],
      textures: [{ id: "x", name: "Brick" }],
    }),
  ).file;

  eq(out.textures.length, 1, "asset survived");
  eq(out.textures[0].path, "", "path defaulted to empty, reported missing at load");
});

/* ---- report ---------------------------------------------------------- */

let failed = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failed++;
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
console.log(`\n  ${results.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
