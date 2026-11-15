/**
 * Tests the axis-view maths in src/scene/views.ts.
 *
 * The one that matters most is nearestView: "flip to the opposite side" reads
 * the camera's actual direction rather than remembering which button was last
 * pressed, so that it still does the right thing after the user has orbited.
 *
 * Run with:  npm run verify
 */

import {
  OPPOSITE_VIEW,
  POLE_NUDGE,
  VIEW_DIRECTIONS,
  VIEW_NAMES,
  cameraPositionFor,
  nearestView,
} from "../src/scene/views.ts";

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

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ---- direction table -------------------------------------------------- */

check("every view has a unit direction", () => {
  for (const view of VIEW_NAMES) {
    const d = VIEW_DIRECTIONS[view];
    ok(Math.abs(Math.hypot(...d) - 1) < 1e-12, `${view} is not unit length`);
  }
});

check("opposite views point the other way", () => {
  for (const view of VIEW_NAMES) {
    const a = VIEW_DIRECTIONS[view];
    const b = VIEW_DIRECTIONS[OPPOSITE_VIEW[view]];
    eq([a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0], `${view} + opposite`);
  }
});

check("opposite is its own inverse", () => {
  for (const view of VIEW_NAMES) {
    eq(OPPOSITE_VIEW[OPPOSITE_VIEW[view]], view, `${view} round trip`);
  }
});

check("front looks down -Z, right down -X, top down -Y", () => {
  // The camera sits on the positive side and looks back toward the origin.
  eq(VIEW_DIRECTIONS.front, [0, 0, 1], "front");
  eq(VIEW_DIRECTIONS.right, [1, 0, 0], "right");
  eq(VIEW_DIRECTIONS.top, [0, 1, 0], "top");
});

/* ---- pole nudge ------------------------------------------------------- */

check("pole nudge: only top and bottom are moved off axis", () => {
  // The side views must stay exactly on their axis; nudging them would show
  // a face that is not quite square on, which defeats the point.
  for (const view of ["front", "back", "right", "left"]) {
    const pos = cameraPositionFor(view, [0, 0, 0], 10);
    const dir = VIEW_DIRECTIONS[view];
    eq(pos, [dir[0] * 10, dir[1] * 10, dir[2] * 10], view);
  }
});

check("pole nudge: top and bottom come off the pole in opposite directions", () => {
  // Straight down the up axis, lookAt cannot orient roll and the view
  // collapses, so neither may sit exactly on it.
  const top = cameraPositionFor("top", [0, 0, 0], 10);
  const bottom = cameraPositionFor("bottom", [0, 0, 0], 10);
  ok(top[2] > 0, `top z should be positive, got ${top[2]}`);
  ok(bottom[2] < 0, `bottom z should be negative, got ${bottom[2]}`);
  eq(top[2], -bottom[2], "mirrored");
});

check("pole nudge: stays small enough to be invisible", () => {
  // Big enough that lookAt is well conditioned, small enough that a plan view
  // still reads as square on.
  ok(POLE_NUDGE > 0, "must be non-zero");
  ok(POLE_NUDGE < 0.01, `${POLE_NUDGE} is too large to pass for square on`);
});

check("pole nudge: scales with distance so the angle stays constant", () => {
  const near = cameraPositionFor("top", [0, 0, 0], 10);
  const far = cameraPositionFor("top", [0, 0, 0], 100);
  const angleNear = Math.atan2(near[2], near[1]);
  const angleFar = Math.atan2(far[2], far[1]);
  ok(Math.abs(angleNear - angleFar) < 1e-12, "angle differs with distance");
});

check("pole nudge: a nudged pole still reads as its own view", () => {
  // nearestView is what "flip" relies on, so the nudge must not confuse it.
  for (const view of ["top", "bottom"]) {
    eq(nearestView(cameraPositionFor(view, [0, 0, 0], 10)), view, view);
  }
});

/* ---- nearestView ------------------------------------------------------ */

check("nearestView: an exact axis offset names that view", () => {
  for (const view of VIEW_NAMES) {
    const d = VIEW_DIRECTIONS[view];
    eq(nearestView([d[0] * 7, d[1] * 7, d[2] * 7]), view, view);
  }
});

check("nearestView: picks the dominant axis", () => {
  eq(nearestView([10, 1, 2]), "right", "mostly +X");
  eq(nearestView([-10, 1, 2]), "left", "mostly -X");
  eq(nearestView([1, 10, 2]), "top", "mostly +Y");
  eq(nearestView([1, -10, 2]), "bottom", "mostly -Y");
  eq(nearestView([1, 2, 10]), "front", "mostly +Z");
  eq(nearestView([1, 2, -10]), "back", "mostly -Z");
});

check("nearestView: the default three-quarter camera reads as front", () => {
  // The start position is [6, 5, 8]. Z is the largest component, so the
  // nearest axis view is the front one, not the top.
  eq(nearestView([6, 5, 8]), "front", "default camera");
});

check("nearestView: ties resolve deterministically", () => {
  // A perfect diagonal has no dominant axis. Fixed order Y, then X, then Z.
  eq(nearestView([5, 5, 5]), "top", "all equal");
  eq(nearestView([5, 0, 5]), "right", "X ties Z");
  eq(nearestView([0, 5, 5]), "top", "Y ties Z");
});

check("nearestView: a zero offset does not produce rubbish", () => {
  // Happens if the camera is exactly on its target.
  ok(VIEW_NAMES.includes(nearestView([0, 0, 0])), "names a real view");
});

check("nearestView: flipping twice returns to the original view", () => {
  for (const view of VIEW_NAMES) {
    const d = VIEW_DIRECTIONS[view];
    const once = OPPOSITE_VIEW[nearestView([d[0] * 3, d[1] * 3, d[2] * 3])];
    const back = OPPOSITE_VIEW[
      nearestView(cameraPositionFor(once, [0, 0, 0], 3))
    ];
    eq(back, view, `${view} flipped twice`);
  }
});

/* ---- cameraPositionFor ------------------------------------------------ */

check("cameraPositionFor: sits at the requested distance from the target", () => {
  for (const view of VIEW_NAMES) {
    const target = [2, 3, -4];
    const pos = cameraPositionFor(view, target, 12);
    const d = Math.hypot(
      pos[0] - target[0],
      pos[1] - target[1],
      pos[2] - target[2],
    );
    // The pole nudge adds a vanishing amount to the poles' distance.
    ok(Math.abs(d - 12) < 1e-3, `${view} is ${d} away, expected 12`);
  }
});

check("cameraPositionFor: offsets from the target, not the origin", () => {
  // Preserving the orbit target is what lets an axis view work on something
  // you have panned over to, instead of yanking the camera back to origin.
  eq(cameraPositionFor("front", [5, 1, 0], 10), [5, 1, 10], "front of target");

  const top = cameraPositionFor("top", [5, 1, 0], 10);
  eq([top[0], top[1]], [5, 11], "above target");
  ok(Math.abs(top[2]) < 0.1, `only nudged in z, got ${top[2]}`);
});

check("cameraPositionFor: zero distance degenerates to the target", () => {
  eq(cameraPositionFor("front", [1, 2, 3], 0), [1, 2, 3], "no distance");
  eq(cameraPositionFor("top", [1, 2, 3], 0), [1, 2, 3], "no distance at a pole");
});

/* ---- report ---------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
