/**
 * Checks that primitive parameter specs and the geometry builder agree.
 *
 * PRIMITIVE_PARAMS in src/types/scene.ts declares the editable numbers; the
 * switch in src/geometry/buildGeometry.ts reads them off the params bag as
 * `p.width`, `p.radialSegments` and so on. Nothing in the type system ties
 * those together -- the bag is Record<string, number> -- so a rename on one
 * side gives you `undefined` on the other, which becomes NaN geometry and an
 * object that silently fails to render.
 *
 * Rather than mirroring the specs (which would only test the copy), this
 * reads both source files and compares the names it finds in each. It then
 * builds every primitive at its defaults and at its clamp extremes, and
 * checks the resulting vertex buffers for NaN.
 *
 * Run with:  node scripts/verify-params.mjs
 */

import { readFileSync } from "node:fs";
import * as THREE from "three";

const scene = readFileSync("src/types/scene.ts", "utf8");
const builder = readFileSync("src/geometry/buildGeometry.ts", "utf8");

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", `${name} :: ${err.message}`]);
  }
};

/* ---- parse PRIMITIVE_PARAMS out of scene.ts ------------------------ */

function parseSpecs(source) {
  const start = source.indexOf("export const PRIMITIVE_PARAMS");
  if (start === -1) throw new Error("PRIMITIVE_PARAMS not found in scene.ts");
  const body = source.slice(start, source.indexOf("\n};", start));

  const specs = {};
  // Each primitive opens a block:  box: {
  const blocks = [...body.matchAll(/^  (\w+): \{$/gm)];
  for (let i = 0; i < blocks.length; i++) {
    const kind = blocks[i][1];
    const from = blocks[i].index;
    const to = i + 1 < blocks.length ? blocks[i + 1].index : body.length;
    const chunk = body.slice(from, to);
    // ...containing lines like:  radialSegments: segments("Sides", 32),
    specs[kind] = [...chunk.matchAll(/^    (\w+): (?:size|segments)\(/gm)].map(
      (m) => m[1],
    );
  }
  return specs;
}

/** Every `p.<name>` the builder reads, per primitive case. */
function parseBuilderUsage(source) {
  const start = source.indexOf("function buildPrimitive");
  if (start === -1) throw new Error("buildPrimitive not found");

  // Bounded to this function. Scanning to end-of-file meant any later switch
  // over the same primitive names -- a measurement helper, say -- silently
  // became the thing under test. A closing brace in column zero is the end of
  // the function; every nested one is indented.
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end === -1 ? undefined : end);

  const usage = {};
  const cases = [...body.matchAll(/case "(\w+)":/g)];
  for (let i = 0; i < cases.length; i++) {
    const kind = cases[i][1];
    const from = cases[i].index;
    const to = i + 1 < cases.length ? cases[i + 1].index : body.length;
    const chunk = body.slice(from, to);
    usage[kind] = [...new Set([...chunk.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))];
  }
  return usage;
}

const specs = parseSpecs(scene);
const usage = parseBuilderUsage(builder);

check("parsed specs for all five primitives", () => {
  const kinds = ["box", "sphere", "cylinder", "cone", "plane"];
  for (const k of kinds) {
    if (!specs[k]?.length) throw new Error(`no specs parsed for ${k}`);
    if (!usage[k]?.length) throw new Error(`no builder usage parsed for ${k}`);
  }
});

for (const kind of Object.keys(specs)) {
  check(`${kind}: builder reads only declared params`, () => {
    const undeclared = usage[kind].filter((n) => !specs[kind].includes(n));
    if (undeclared.length) {
      throw new Error(
        `builder reads p.${undeclared.join(", p.")} — not in PRIMITIVE_PARAMS`,
      );
    }
  });

  check(`${kind}: every declared param is used`, () => {
    const unused = specs[kind].filter((n) => !usage[kind].includes(n));
    if (unused.length) {
      throw new Error(
        `${unused.join(", ")} declared but never read by the builder`,
      );
    }
  });
}

/* ---- build geometry at defaults and at clamp extremes -------------- */

function parseNumbers(source, kind, name) {
  // size("Width", 1)  |  size("Top radius", 0.5, 0)  |  segments("Sides", 32)
  const block = source.slice(source.indexOf(`  ${kind}: {`));
  const line = block.match(
    new RegExp(`^    ${name}: (size|segments)\\(([^)]*)\\)`, "m"),
  );
  if (!line) throw new Error(`could not parse ${kind}.${name}`);
  const fn = line[1];
  const args = line[2].split(",").map((s) => s.trim());
  const def = Number(args[1]);
  if (fn === "size") {
    return { def, min: args[2] !== undefined ? Number(args[2]) : 0.01, max: 1000 };
  }
  return {
    def,
    min: args[2] !== undefined ? Number(args[2]) : 3,
    max: args[3] !== undefined ? Number(args[3]) : 128,
  };
}

function build(kind, p) {
  switch (kind) {
    case "box":
      return new THREE.BoxGeometry(p.width, p.height, p.depth);
    case "sphere":
      return new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments);
    case "cylinder":
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments);
    case "cone":
      return new THREE.ConeGeometry(p.radius, p.height, p.radialSegments);
    case "plane":
      return new THREE.PlaneGeometry(p.width, p.height);
    default:
      throw new Error("unknown primitive " + kind);
  }
}

function assertFinite(geo, label) {
  const arr = geo.getAttribute("position").array;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`${label}: NaN at vertex ${i}`);
  }
  if (arr.length === 0) throw new Error(`${label}: produced no vertices`);
}

for (const kind of Object.keys(specs)) {
  const ranges = Object.fromEntries(
    specs[kind].map((n) => [n, parseNumbers(scene, kind, n)]),
  );

  check(`${kind}: builds at defaults`, () => {
    const p = Object.fromEntries(specs[kind].map((n) => [n, ranges[n].def]));
    assertFinite(build(kind, p), `${kind} defaults`);
  });

  check(`${kind}: builds at minimums`, () => {
    const p = Object.fromEntries(specs[kind].map((n) => [n, ranges[n].min]));
    assertFinite(build(kind, p), `${kind} minimums`);
  });

  check(`${kind}: builds at maximums`, () => {
    const p = Object.fromEntries(specs[kind].map((n) => [n, ranges[n].max]));
    assertFinite(build(kind, p), `${kind} maximums`);
  });

  check(`${kind}: segment caps keep vertex counts sane`, () => {
    const p = Object.fromEntries(specs[kind].map((n) => [n, ranges[n].max]));
    const count = build(kind, p).getAttribute("position").count;
    if (count > 100_000) {
      throw new Error(`${count} vertices at max settings — cap is too high`);
    }
  });
}

/* ---- report --------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
