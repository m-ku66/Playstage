/**
 * Tests the real scene file parser in src/io/sceneFile.ts.
 *
 * Imports the actual source via Node's type stripping, so there is no mirrored
 * copy to drift out of sync — the same approach as verify-hierarchy.mjs.
 *
 * The cases here are mostly hostile input, because that is the point of the
 * parser: a scene file can be hand-edited, half-written by a crash, or synced
 * badly, and the renderer throws or recurses forever on several shapes of bad
 * data. Each test below corresponds to one way the app used to be breakable.
 *
 * Run with:  node --experimental-strip-types scripts/verify-scenefile.mjs
 * Or:        npm run verify
 */

import {
  SceneFileError,
  parseSceneFile,
  serializeScene,
} from "../src/io/sceneFile.ts";
import {
  PRIMITIVE_DEFAULTS,
  PRIMITIVE_GROUP_COUNT,
  SCENE_FORMAT_VERSION,
} from "../src/types/scene.ts";

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
const ok = (cond, label) => {
  if (!cond) throw new Error(label);
};
const throws = (fn, label) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof SceneFileError) return err;
    throw new Error(`${label}: threw ${err.name}, expected SceneFileError`);
  }
  throw new Error(`${label}: did not throw`);
};

/** A minimal valid scene file body. */
const file = (over = {}) =>
  JSON.stringify({
    format: "playstage-scene",
    version: SCENE_FORMAT_VERSION,
    name: "Test",
    objects: [],
    hotspots: [],
    textures: [],
    ...over,
  });

const box = (over = {}) => ({
  id: "b1",
  name: "Box",
  parentId: null,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  geometry: {
    kind: "primitive",
    primitive: "box",
    params: { ...PRIMITIVE_DEFAULTS.box },
  },
  materials: {},
  visible: true,
  locked: false,
  ...over,
});

/* ---- fatal cases ----------------------------------------------------- */

check("rejects text that is not JSON", () => {
  throws(() => parseSceneFile("not json at all"), "garbage");
});

check("rejects JSON that is not an object", () => {
  throws(() => parseSceneFile("[1,2,3]"), "array");
  throws(() => parseSceneFile('"a string"'), "string");
});

check("rejects a file without the playstage-scene marker", () => {
  throws(
    () => parseSceneFile(JSON.stringify({ version: 1, objects: [] })),
    "no marker",
  );
});

check("rejects a scene from a newer format version", () => {
  const err = throws(
    () => parseSceneFile(file({ version: SCENE_FORMAT_VERSION + 1 })),
    "future version",
  );
  ok(/newer version/i.test(err.message), "message mentions a newer version");
});

check("accepts an older format version", () => {
  const { file: out } = parseSceneFile(file({ version: 1 }));
  eq(out.version, SCENE_FORMAT_VERSION, "upgraded to current");
});

/* ---- round trip ------------------------------------------------------ */

check("round trips a scene unchanged", () => {
  const original = parseSceneFile(file({ objects: [box()] })).file;
  const again = parseSceneFile(serializeScene(original)).file;
  eq(again, original, "parse(serialize(x)) === x");
});

check("serializeScene emits indented JSON ending in a newline", () => {
  const text = serializeScene(parseSceneFile(file()).file);
  ok(text.includes("\n  "), "indented");
  ok(text.endsWith("\n"), "trailing newline");
});

/* ---- primitive params ------------------------------------------------ */

check("fills in missing primitive params from the spec defaults", () => {
  // undefined would reach Three.js and produce NaN vertex data.
  const { file: out } = parseSceneFile(
    file({
      objects: [box({ geometry: { kind: "primitive", primitive: "box", params: { width: 2 } } })],
    }),
  );
  eq(out.objects[0].geometry.params.width, 2, "kept the saved value");
  eq(
    out.objects[0].geometry.params.height,
    PRIMITIVE_DEFAULTS.box.height,
    "defaulted the missing one",
  );
  eq(out.objects[0].geometry.params.depth, PRIMITIVE_DEFAULTS.box.depth, "and the other");
});

check("clamps out-of-range primitive params", () => {
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({
          geometry: {
            kind: "primitive",
            primitive: "sphere",
            params: { radius: 0.5, widthSegments: 50000, heightSegments: -4 },
          },
        }),
      ],
    }),
  );
  const p = out.objects[0].geometry.params;
  ok(p.widthSegments <= 128, `widthSegments clamped, got ${p.widthSegments}`);
  ok(p.heightSegments >= 2, `heightSegments clamped, got ${p.heightSegments}`);
});

check("replaces non-finite primitive params with the default", () => {
  // JSON cannot hold NaN, but null and strings survive a hand edit.
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({
          geometry: {
            kind: "primitive",
            primitive: "box",
            params: { width: null, height: "tall", depth: 3 },
          },
        }),
      ],
    }),
  );
  const p = out.objects[0].geometry.params;
  eq(p.width, PRIMITIVE_DEFAULTS.box.width, "null -> default");
  eq(p.height, PRIMITIVE_DEFAULTS.box.height, "string -> default");
  eq(p.depth, 3, "valid value kept");
});

check("drops primitive params that are not in the spec", () => {
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({
          geometry: {
            kind: "primitive",
            primitive: "plane",
            params: { width: 1, height: 1, bogus: 7 },
          },
        }),
      ],
    }),
  );
  ok(!("bogus" in out.objects[0].geometry.params), "stray key removed");
});

check("falls back to a group for an unknown primitive type", () => {
  const { file: out, warnings } = parseSceneFile(
    file({
      objects: [box({ geometry: { kind: "primitive", primitive: "torus", params: {} } })],
    }),
  );
  eq(out.objects[0].geometry.kind, "group", "became a group");
  ok(warnings.length > 0, "warned about it");
});

/* ---- unimplemented geometry ------------------------------------------ */

check("converts unimplemented geometry kinds to groups, keeping children", () => {
  // buildGeometry THROWS on these, inside a useMemo with no error boundary,
  // so one of them in a file would take down the whole React tree.
  for (const kind of ["extrude", "lathe", "csg"]) {
    const { file: out, warnings } = parseSceneFile(
      file({
        objects: [
          box({ id: "p", geometry: { kind } }),
          box({ id: "c", parentId: "p" }),
        ],
      }),
    );
    eq(out.objects[0].geometry.kind, "group", `${kind} -> group`);
    eq(out.objects[1].parentId, "p", `${kind}: child stayed attached`);
    ok(
      warnings.some((w) => w.includes(kind)),
      `${kind}: warned by name`,
    );
  }
});

/* ---- transforms ------------------------------------------------------ */

check("nudges a zero scale component off zero, keeping its sign", () => {
  // A zero scale makes the world matrix singular, so reparenting a child
  // through this object decomposes to NaN.
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, -0, -1] },
        }),
      ],
    }),
  );
  const [x, y, z] = out.objects[0].transform.scale;
  ok(x > 0 && x < 0.01, `x nudged positive, got ${x}`);
  ok(Math.abs(y) > 0, `y nudged off zero, got ${y}`);
  eq(z, -1, "a legitimate negative scale is untouched");
});

check("replaces a malformed transform with the identity", () => {
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({ transform: { position: [1, "x", null], rotation: "none", scale: [2, 2] } }),
      ],
    }),
  );
  const t = out.objects[0].transform;
  eq(t.position, [1, 0, 0], "bad components zeroed, good one kept");
  eq(t.rotation, [0, 0, 0], "non-array rotation -> identity");
  eq(t.scale, [1, 1, 1], "wrong-length scale -> identity");
});

check("replaces a missing transform entirely", () => {
  const { file: out } = parseSceneFile(file({ objects: [box({ transform: undefined })] }));
  eq(out.objects[0].transform.scale, [1, 1, 1], "identity scale");
});

/* ---- hierarchy ------------------------------------------------------- */

check("moves an object with a missing parent to the top level", () => {
  const { file: out, warnings } = parseSceneFile(
    file({ objects: [box({ id: "a", parentId: "ghost" })] }),
  );
  eq(out.objects[0].parentId, null, "orphan reparented to root");
  ok(warnings.length > 0, "warned");
});

check("breaks a two-object parent loop", () => {
  // Left alone, SceneObjectView recurses on this until the stack overflows.
  const { file: out, warnings } = parseSceneFile(
    file({
      objects: [box({ id: "a", parentId: "b" }), box({ id: "b", parentId: "a" })],
    }),
  );
  const roots = out.objects.filter((o) => o.parentId === null);
  eq(roots.length, 1, "exactly one of the pair was cut loose");
  ok(warnings.some((w) => /loop/i.test(w)), "warned about a loop");
});

check("breaks a three-object parent loop", () => {
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({ id: "a", parentId: "c" }),
        box({ id: "b", parentId: "a" }),
        box({ id: "c", parentId: "b" }),
      ],
    }),
  );
  eq(out.objects.filter((o) => o.parentId === null).length, 1, "one cut");
});

check("breaks a self-parent loop", () => {
  const { file: out } = parseSceneFile(
    file({ objects: [box({ id: "a", parentId: "a" })] }),
  );
  eq(out.objects[0].parentId, null, "self link cut");
});

check("leaves a legitimate deep hierarchy alone", () => {
  const { file: out, warnings } = parseSceneFile(
    file({
      objects: [
        box({ id: "a" }),
        box({ id: "b", parentId: "a" }),
        box({ id: "c", parentId: "b" }),
        box({ id: "d", parentId: "b" }),
      ],
    }),
  );
  eq(out.objects.map((o) => o.parentId), [null, "a", "b", "b"], "chain intact");
  eq(warnings, [], "no warnings on a clean file");
});

/* ---- ids ------------------------------------------------------------- */

check("gives duplicate ids fresh ones and keeps children attached", () => {
  const { file: out, warnings } = parseSceneFile(
    file({
      objects: [box({ id: "dup" }), box({ id: "dup" }), box({ id: "kid", parentId: "dup" })],
    }),
  );
  const ids = out.objects.map((o) => o.id);
  eq(new Set(ids).size, 3, "all ids unique");
  eq(ids[0], "dup", "first occurrence keeps the id");
  eq(out.objects[2].parentId, "dup", "child follows the first occurrence");
  ok(warnings.some((w) => /new id/i.test(w)), "warned");
});

check("gives a missing id a fresh one", () => {
  const { file: out } = parseSceneFile(file({ objects: [box({ id: undefined })] }));
  ok(typeof out.objects[0].id === "string" && out.objects[0].id.length > 0, "has an id");
});

check("drops object entries that are not objects", () => {
  const { file: out, warnings } = parseSceneFile(
    file({ objects: [box(), null, 42, "nope"] }),
  );
  eq(out.objects.length, 1, "only the real one survived");
  ok(warnings.some((w) => /malformed/i.test(w)), "warned");
});

check("opens empty when the object list is missing or wrong", () => {
  eq(parseSceneFile(file({ objects: undefined })).file.objects, [], "missing");
  eq(parseSceneFile(file({ objects: "nope" })).file.objects, [], "not an array");
});

/* ---- materials ------------------------------------------------------- */

check("builds one material slot per face of the primitive", () => {
  for (const primitive of Object.keys(PRIMITIVE_GROUP_COUNT)) {
    const { file: out } = parseSceneFile(
      file({
        objects: [
          box({
            geometry: { kind: "primitive", primitive, params: {} },
            materials: {},
          }),
        ],
      }),
    );
    eq(
      Object.keys(out.objects[0].materials).length,
      PRIMITIVE_GROUP_COUNT[primitive],
      `${primitive} slot count`,
    );
  }
});

check("discards material slots beyond the primitive's face count", () => {
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({
          geometry: { kind: "primitive", primitive: "sphere", params: {} },
          materials: { 0: { color: "#ff0000" }, 1: { color: "#00ff00" }, 9: {} },
        }),
      ],
    }),
  );
  eq(Object.keys(out.objects[0].materials), ["0"], "sphere has one slot");
  eq(out.objects[0].materials[0].color, "#ff0000", "slot 0 preserved");
});

check("gives a group no material slots", () => {
  const { file: out } = parseSceneFile(
    file({ objects: [box({ geometry: { kind: "group" }, materials: { 0: {} } })] }),
  );
  eq(out.objects[0].materials, {}, "no slots on a group");
});

check("rejects a colour Three.js would not understand", () => {
  // Three.Color warns and keeps its previous value on an unknown string, which
  // shows the wrong colour with no visible cause.
  const { file: out } = parseSceneFile(
    file({
      objects: [
        box({
          materials: {
            0: { color: "rebeccapurple" },
            1: { color: "#abc" },
            2: { color: "#AABBCC" },
            3: { color: "#12345" },
          },
        }),
      ],
    }),
  );
  const m = out.objects[0].materials;
  eq(m[0].color, "#c4c4be", "named colour -> default");
  eq(m[1].color, "#abc", "short hex kept");
  eq(m[2].color, "#AABBCC", "long hex kept");
  eq(m[3].color, "#c4c4be", "five digits -> default");
});

check("clears a texture reference that is not in the file", () => {
  const { file: out } = parseSceneFile(
    file({
      textures: [{ id: "t1", name: "Brick", path: "", dataUrl: null }],
      objects: [box({ materials: { 0: { textureId: "t1" }, 1: { textureId: "gone" } } })],
    }),
  );
  eq(out.objects[0].materials[0].textureId, "t1", "valid reference kept");
  eq(out.objects[0].materials[1].textureId, null, "dangling reference cleared");
});

/* ---- textures and hotspots ------------------------------------------- */

check("drops texture entries without an id, and deduplicates", () => {
  const { file: out } = parseSceneFile(
    file({
      textures: [
        { id: "t1", name: "A" },
        { id: "t1", name: "duplicate" },
        { name: "no id" },
        "nope",
      ],
    }),
  );
  eq(out.textures.length, 1, "one survivor");
  eq(out.textures[0].name, "A", "first occurrence kept");
});

check("clamps hotspot field of view into a usable range", () => {
  const { file: out } = parseSceneFile(
    file({
      hotspots: [
        { id: "h1", name: "Wide", position: [1, 2, 3], target: [0, 0, 0], fov: 400 },
        { id: "h2", name: "Narrow", position: [1, 2, 3], target: [0, 0, 0], fov: 0 },
      ],
    }),
  );
  ok(out.hotspots[0].fov <= 120, `wide clamped, got ${out.hotspots[0].fov}`);
  ok(out.hotspots[1].fov >= 10, `narrow clamped, got ${out.hotspots[1].fov}`);
});

check("defaults a malformed hotspot rather than dropping it", () => {
  const { file: out } = parseSceneFile(
    file({ hotspots: [{ id: "h1", position: "nope" }] }),
  );
  eq(out.hotspots.length, 1, "kept");
  eq(out.hotspots[0].target, [0, 0, 0], "target defaulted");
  ok(Array.isArray(out.hotspots[0].position), "position is a vector");
});

/* ---- scene name ------------------------------------------------------ */

check("defaults a missing scene name", () => {
  eq(parseSceneFile(file({ name: undefined })).file.name, "Untitled", "missing");
  eq(parseSceneFile(file({ name: 42 })).file.name, "Untitled", "wrong type");
});

/* ---- report ---------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
