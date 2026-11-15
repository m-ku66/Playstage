/**
 * Tests the saved-angle helpers in src/scene/hotspots.ts.
 *
 * Small surface, but two things here are load-bearing: the field-of-view
 * bounds are shared with the scene loader, so a hand-edited file and a typed
 * value cannot disagree about what counts as a usable lens; and makeHotspot
 * copies the pose it is handed rather than storing the reference, since the
 * pose comes out of a store that the render loop overwrites.
 *
 * Run with:  npm run verify
 */

import {
  FOV_DEFAULT,
  FOV_MAX,
  FOV_MIN,
  clampFov,
  makeHotspot,
} from "../src/scene/hotspots.ts";

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

const pose = (over = {}) => ({
  position: [1, 2, 3],
  target: [0, 0, 0],
  fov: 50,
  ...over,
});

/* ---- bounds ----------------------------------------------------------- */

check("the fov range is sane", () => {
  ok(FOV_MIN > 0, "min must be positive");
  ok(FOV_MIN < FOV_MAX, "min must be below max");
  ok(FOV_DEFAULT >= FOV_MIN && FOV_DEFAULT <= FOV_MAX, "default is in range");
});

check("clampFov: leaves a value in range alone", () => {
  eq(clampFov(50), 50, "fifty");
  eq(clampFov(FOV_MIN), FOV_MIN, "at the minimum");
  eq(clampFov(FOV_MAX), FOV_MAX, "at the maximum");
});

check("clampFov: pulls an out-of-range value back", () => {
  eq(clampFov(1), FOV_MIN, "too narrow");
  eq(clampFov(400), FOV_MAX, "too wide");
  eq(clampFov(-30), FOV_MIN, "negative");
});

check("clampFov: falls back to the default for a non-number", () => {
  // Reachable from a hand-edited scene file, where fov could be null or text.
  for (const bad of [NaN, Infinity, -Infinity]) {
    eq(clampFov(bad), FOV_DEFAULT, String(bad));
  }
});

/* ---- makeHotspot ----------------------------------------------------- */

check("makeHotspot: keeps the id and name it is given", () => {
  const h = makeHotspot("abc", "Wide shot", pose());
  eq(h.id, "abc", "id");
  eq(h.name, "Wide shot", "name");
});

check("makeHotspot: stores the pose", () => {
  const h = makeHotspot("a", "View", pose({ position: [4, 5, 6], target: [1, 0, 1] }));
  eq(h.position, [4, 5, 6], "position");
  eq(h.target, [1, 0, 1], "target");
  eq(h.fov, 50, "fov");
});

check("makeHotspot: clamps the lens on the way in", () => {
  eq(makeHotspot("a", "View", pose({ fov: 500 })).fov, FOV_MAX, "too wide");
  eq(makeHotspot("a", "View", pose({ fov: 2 })).fov, FOV_MIN, "too narrow");
});

check("makeHotspot: does not alias the pose it was handed", () => {
  // The pose comes out of a store the render loop rewrites. Keeping the
  // caller's arrays would be a standing invitation for a saved angle to start
  // tracking the live camera.
  const source = pose();
  const h = makeHotspot("a", "View", source);

  source.position[0] = 999;
  source.target[1] = 999;

  eq(h.position, [1, 2, 3], "position is independent");
  eq(h.target, [0, 0, 0], "target is independent");
});

check("makeHotspot: two hotspots from one pose do not share arrays", () => {
  const source = pose();
  const a = makeHotspot("a", "A", source);
  const b = makeHotspot("b", "B", source);

  a.position[0] = 42;
  eq(b.position, [1, 2, 3], "b is unaffected");
});

/* ---- report ---------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
