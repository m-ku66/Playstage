/**
 * Tests the unit display in src/scene/units.ts.
 *
 * One world unit is one metre, and nothing in the scene file changes with the
 * unit system -- it is purely how numbers are written. These tests pin down
 * the conversions and, more importantly, the tick-step choices: a ruler is
 * only useful if its numbers are round, and an imperial ruler stepping by
 * world units would read 3' 3", 6' 7", 9' 10".
 *
 * Run with:  npm run verify
 */

import {
  FEET_PER_METRE,
  RULER_HALF_EXTENT,
  chooseEdgeStep,
  formatLength,
  formatTickValue,
  groundTicks,
  tickSpacingUnits,
  unitSuffix,
} from "../src/scene/units.ts";

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
  if (a !== b) throw new Error(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
};
const ok = (cond, label) => {
  if (!cond) throw new Error(label);
};

/** Metres for a given number of inches, for building exact test cases. */
const metresFromInches = (inches) => inches / (FEET_PER_METRE * 12);

/* ---- formatLength, metric -------------------------------------------- */

check("formatLength metric: whole metres", () => {
  eq(formatLength(1, "metric"), "1 m", "one");
  eq(formatLength(12, "metric"), "12 m", "twelve");
});

check("formatLength metric: trims pointless zeros", () => {
  eq(formatLength(2.5, "metric"), "2.5 m", "2.50 -> 2.5");
  eq(formatLength(3.0, "metric"), "3 m", "3.00 -> 3");
});

check("formatLength metric: rounds to centimetre precision", () => {
  eq(formatLength(12.345, "metric"), "12.35 m", "two places");
});

check("formatLength metric: switches to centimetres below a metre", () => {
  // "0.25 m" is a worse way of saying 25 cm.
  eq(formatLength(0.25, "metric"), "25 cm", "quarter metre");
  eq(formatLength(0.05, "metric"), "5 cm", "five centimetres");
});

check("formatLength metric: zero stays in metres", () => {
  eq(formatLength(0, "metric"), "0 m", "zero");
});

check("formatLength metric: handles negatives", () => {
  eq(formatLength(-2, "metric"), "-2 m", "negative metres");
  eq(formatLength(-0.5, "metric"), "-50 cm", "negative centimetres");
});

/* ---- formatLength, imperial ----------------------------------------- */

check("formatLength imperial: one metre is 3 feet 3 inches", () => {
  eq(formatLength(1, "imperial"), `3' 3"`, "one metre");
});

check("formatLength imperial: an exact foot drops the inches", () => {
  eq(formatLength(metresFromInches(12), "imperial"), "1'", "one foot");
  eq(formatLength(metresFromInches(60), "imperial"), "5'", "five feet");
});

check("formatLength imperial: under a foot shows inches only", () => {
  eq(formatLength(metresFromInches(1), "imperial"), `1"`, "one inch");
  eq(formatLength(metresFromInches(7), "imperial"), `7"`, "seven inches");
});

check("formatLength imperial: rounding up to twelve inches carries", () => {
  // 11.6" must not render as 0' 12".
  eq(formatLength(metresFromInches(11.6), "imperial"), "1'", "carry");
});

check("formatLength imperial: handles negatives", () => {
  eq(formatLength(-1, "imperial"), `-3' 3"`, "negative");
});

/* ---- non-finite ------------------------------------------------------ */

check("formatLength: non-finite values do not print as NaN", () => {
  for (const system of ["metric", "imperial"]) {
    eq(formatLength(NaN, system), "—", `${system} NaN`);
    eq(formatLength(Infinity, system), "—", `${system} Infinity`);
  }
});

/* ---- suffix ---------------------------------------------------------- */

check("unitSuffix: names the unit", () => {
  eq(unitSuffix("metric"), "m", "metric");
  eq(unitSuffix("imperial"), "ft", "imperial");
});

/* ---- tick spacing ---------------------------------------------------- */

check("tickSpacingUnits: metric steps by five metres", () => {
  eq(tickSpacingUnits("metric"), 5, "five");
});

check("tickSpacingUnits: imperial steps by ten feet, in world units", () => {
  const step = tickSpacingUnits("imperial");
  ok(Math.abs(step * FEET_PER_METRE - 10) < 1e-9, `got ${step * FEET_PER_METRE} feet`);
});

check("formatTickValue: metric prints metres", () => {
  eq(formatTickValue(5, "metric"), "5", "five");
  eq(formatTickValue(-15, "metric"), "-15", "negative");
});

check("formatTickValue: imperial prints whole feet", () => {
  // The reason tick spacing is chosen in feet: these come out round.
  const step = tickSpacingUnits("imperial");
  eq(formatTickValue(step, "imperial"), "10", "one step");
  eq(formatTickValue(step * 3, "imperial"), "30", "three steps");
  eq(formatTickValue(-step * 2, "imperial"), "-20", "negative");
});

/* ---- groundTicks ----------------------------------------------------- */

check("groundTicks: metric covers the grid in five-metre steps", () => {
  const ticks = groundTicks("metric");
  eq(ticks.length, 9, "nine ticks");
  eq(ticks[0], -RULER_HALF_EXTENT, "starts at the far edge");
  eq(ticks[ticks.length - 1], RULER_HALF_EXTENT, "ends at the other");
});

check("groundTicks: includes the origin", () => {
  for (const system of ["metric", "imperial"]) {
    ok(
      groundTicks(system).some((t) => Math.abs(t) < 1e-9),
      `${system} has a zero tick`,
    );
  }
});

check("groundTicks: is symmetric about the origin", () => {
  for (const system of ["metric", "imperial"]) {
    const ticks = groundTicks(system);
    for (let i = 0; i < ticks.length; i++) {
      const mirrored = ticks[ticks.length - 1 - i];
      ok(
        Math.abs(ticks[i] + mirrored) < 1e-9,
        `${system}: ${ticks[i]} vs ${mirrored}`,
      );
    }
  }
});

check("groundTicks: never runs past the ruler extent", () => {
  for (const system of ["metric", "imperial"]) {
    for (const t of groundTicks(system)) {
      ok(
        Math.abs(t) <= RULER_HALF_EXTENT + 1e-9,
        `${system}: ${t} exceeds ${RULER_HALF_EXTENT}`,
      );
    }
  }
});

check("groundTicks: imperial lands on whole tens of feet", () => {
  for (const t of groundTicks("imperial")) {
    const feet = t * FEET_PER_METRE;
    ok(Math.abs(feet % 10) < 1e-9, `${feet} feet is not a multiple of ten`);
  }
});

/* ---- chooseEdgeStep -------------------------------------------------- */

check("chooseEdgeStep: picks the smallest step that stays legible", () => {
  // At 100 px per unit, a 1 m step is 100 px apart; half a metre is only 50.
  eq(chooseEdgeStep(100, "metric"), 1, "one metre");
});

check("chooseEdgeStep: grows the step as you zoom out", () => {
  const near = chooseEdgeStep(400, "metric");
  const mid = chooseEdgeStep(100, "metric");
  const far = chooseEdgeStep(10, "metric");
  ok(near <= mid, `near ${near} should not exceed mid ${mid}`);
  ok(mid <= far, `mid ${mid} should not exceed far ${far}`);
  ok(far > near, `zooming out should coarsen: ${near} -> ${far}`);
});

check("chooseEdgeStep: keeps ticks at least 64px apart where it can", () => {
  for (const system of ["metric", "imperial"]) {
    for (const ppu of [5, 12, 37, 100, 260, 900]) {
      const gap = chooseEdgeStep(ppu, system) * ppu;
      ok(gap >= 64, `${system} at ${ppu}px/unit gave a ${gap.toFixed(1)}px gap`);
    }
  }
});

check("chooseEdgeStep: imperial steps are round numbers of feet", () => {
  const ROUND_FEET = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500];
  for (const ppu of [5, 12, 37, 100, 260, 900]) {
    const feet = chooseEdgeStep(ppu, "imperial") * FEET_PER_METRE;
    ok(
      ROUND_FEET.some((f) => Math.abs(f - feet) < 1e-9),
      `${feet} feet is not a round step`,
    );
  }
});

check("chooseEdgeStep: survives a degenerate scale", () => {
  // pixelsPerUnit is zero before the first frame has been measured.
  for (const system of ["metric", "imperial"]) {
    for (const bad of [0, -5, NaN, Infinity]) {
      const step = chooseEdgeStep(bad, system);
      ok(Number.isFinite(step) && step > 0, `${system} ${bad} gave ${step}`);
    }
  }
});

/* ---- report ---------------------------------------------------------- */

const failed = results.filter(([s]) => s === "FAIL");
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const [status, name] of results) {
  console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${name}`);
}
process.exit(failed.length ? 1 : 0);
