/**
 * Unit display.
 *
 * One world unit is one metre. That is the only place the physical scale of a
 * Playstage scene is defined, and everything else here derives from it: the
 * default grid is therefore a 1 m cell with a 5 m section, a door is about two
 * units tall and a room about three.
 *
 * Nothing in the stored scene file changes with the unit system -- it is a
 * display preference only, so switching between metric and imperial can never
 * alter the geometry.
 */

export type UnitSystem = "metric" | "imperial";

export const FEET_PER_METRE = 3.280839895013123;
const INCHES_PER_FOOT = 12;

/** How far the ground ruler reaches from the origin, matching the 40x40 grid. */
export const RULER_HALF_EXTENT = 20;

/** Trims pointless trailing zeros: 2.50 -> 2.5, 3.00 -> 3. */
function trim(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}

/**
 * A length, written the way someone building a room would say it.
 *
 * Metric switches to centimetres below a metre, because "0.25 m" is a worse
 * way of saying 25 cm. Imperial rounds to whole inches: this is a blockout
 * tool, and sixteenths would imply a precision the gizmo's snap settings do
 * not offer.
 */
export function formatLength(units: number, system: UnitSystem): string {
  if (!Number.isFinite(units)) return "—";

  if (system === "metric") {
    return Math.abs(units) < 1 && units !== 0
      ? `${trim(units * 100, 1)} cm`
      : `${trim(units, 2)} m`;
  }

  const sign = units < 0 ? "-" : "";
  const totalInches = Math.abs(units) * FEET_PER_METRE * INCHES_PER_FOOT;

  let feet = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = Math.round(totalInches - feet * INCHES_PER_FOOT);
  // Rounding 11.6" up lands on 12, which is a foot.
  if (inches === INCHES_PER_FOOT) {
    feet += 1;
    inches = 0;
  }

  if (feet === 0) return `${sign}${inches}"`;
  if (inches === 0) return `${sign}${feet}'`;
  return `${sign}${feet}' ${inches}"`;
}

/** Short label for the unit itself, for an axis badge or a column header. */
export function unitSuffix(system: UnitSystem): string {
  return system === "metric" ? "m" : "ft";
}

/**
 * Distance between ruler ticks, in world units.
 *
 * Chosen in the DISPLAY unit and then converted, which is the whole trick: a
 * tick every world unit would label an imperial ruler 3' 3", 6' 7", 9' 10",
 * and so on. Stepping by whole feet instead gives round numbers on both
 * rulers.
 */
export function tickSpacingUnits(system: UnitSystem): number {
  return system === "metric" ? 5 : 10 / FEET_PER_METRE;
}

/** The number to print at a tick: metres, or whole feet. */
export function formatTickValue(units: number, system: UnitSystem): string {
  return system === "metric"
    ? trim(units, 2)
    : String(Math.round(units * FEET_PER_METRE));
}

/** Tick positions along one axis, in world units, centred on the origin. */
export function groundTicks(system: UnitSystem): number[] {
  const step = tickSpacingUnits(system);
  const steps = Math.floor(RULER_HALF_EXTENT / step);

  const out: number[] = [];
  for (let k = -steps; k <= steps; k++) out.push(k * step);
  return out;
}

/* ------------------------------------------------------------------ */
/* Edge strips                                                         */
/* ------------------------------------------------------------------ */

/** Smallest gap, in screen pixels, that two labelled ticks may sit at. */
const MIN_TICK_PIXELS = 64;

/** Round steps to choose from, in display units. */
const METRIC_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250];
const IMPERIAL_STEPS_FEET = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500];

/**
 * Picks a tick step for the edge strips, given the current zoom.
 *
 * Unlike the ground ruler, these are screen-space, so the step has to adapt:
 * zoomed right out, a 1 m tick would be a solid grey smear. Returns a step in
 * world units, always corresponding to a round number in the display unit.
 */
export function chooseEdgeStep(
  pixelsPerUnit: number,
  system: UnitSystem,
): number {
  const candidates =
    system === "metric"
      ? METRIC_STEPS
      : IMPERIAL_STEPS_FEET.map((ft) => ft / FEET_PER_METRE);

  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
    return candidates[candidates.length - 1];
  }

  for (const step of candidates) {
    if (step * pixelsPerUnit >= MIN_TICK_PIXELS) return step;
  }
  return candidates[candidates.length - 1];
}
