import type { Vec3 } from "../types/scene";

/**
 * The six axis-aligned camera views.
 *
 * Playstage is Y-up, so "front" looks along -Z from +Z, "right" looks along
 * -X from +X, and "top" looks straight down. These are the views that make a
 * blockout useful as a drawing reference: an elevation or a plan, rather than
 * a three-quarter perspective you have to mentally un-distort.
 *
 * Pure data and pure functions, so the view logic is testable without a
 * camera or a renderer.
 */

export type ViewName = "front" | "back" | "right" | "left" | "top" | "bottom";

export const VIEW_NAMES: ViewName[] = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
];

/**
 * Unit direction from the orbit target TOWARD the camera.
 *
 * Stored this way round because that is how the camera gets placed: target
 * plus direction times the current distance, which preserves how far out the
 * user had zoomed.
 */
export const VIEW_DIRECTIONS: Record<ViewName, Vec3> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

export const OPPOSITE_VIEW: Record<ViewName, ViewName> = {
  front: "back",
  back: "front",
  right: "left",
  left: "right",
  top: "bottom",
  bottom: "top",
};

/** Human label for the toolbar and the shortcut list. */
export const VIEW_LABELS: Record<ViewName, string> = {
  front: "Front",
  back: "Back",
  right: "Right",
  left: "Left",
  top: "Top",
  bottom: "Bottom",
};

/**
 * How far off a pole to nudge the camera, as a fraction of its distance.
 *
 * A top or bottom view looks straight along the camera's own up axis, where
 * lookAt has no way to orient the roll and the view collapses. The obvious fix
 * is to swap camera.up -- but OrbitControls uses that as its polar axis, so
 * changing it makes every subsequent orbit feel rotated. Nudging the camera a
 * hair off the pole instead keeps a Y-up camera valid everywhere.
 *
 * It also lands the plan view the right way round for free: with up still Y,
 * a camera just past +Y puts world +X to screen right and world +Z down the
 * screen, which is how a floor plan reads.
 */
export const POLE_NUDGE = 1e-3;

/**
 * The named view a camera offset is closest to.
 *
 * Used by "flip to the opposite side": rather than tracking which view was
 * last applied -- which goes stale the moment the user orbits -- this reads
 * the camera's actual direction, so flipping always relates to what is on
 * screen right now.
 *
 * Ties are broken in a fixed order (Y, then X, then Z) so the result is
 * deterministic for a perfectly diagonal offset. A zero offset cannot name a
 * direction, so it reports the front view.
 */
export function nearestView(offset: Vec3): ViewName {
  const [x, y, z] = offset;
  const [ax, ay, az] = [Math.abs(x), Math.abs(y), Math.abs(z)];

  if (ax === 0 && ay === 0 && az === 0) return "front";

  if (ay >= ax && ay >= az) return y >= 0 ? "top" : "bottom";
  if (ax >= az) return x >= 0 ? "right" : "left";
  return z >= 0 ? "front" : "back";
}

/**
 * Where to put the camera for a view, given the target and how far out to sit.
 *
 * Offsets from the TARGET rather than the origin, so an axis view works on
 * whatever you have panned over to instead of yanking the camera home. The
 * distance is caller-supplied, which is how snapping to a view preserves how
 * far out the user had zoomed.
 */
export function cameraPositionFor(
  view: ViewName,
  target: Vec3,
  distance: number,
): Vec3 {
  const dir = VIEW_DIRECTIONS[view];
  const position: Vec3 = [
    target[0] + dir[0] * distance,
    target[1] + dir[1] * distance,
    target[2] + dir[2] * distance,
  ];

  // Only the poles need the nudge; the four side views are already well
  // defined against a Y-up camera.
  if (view === "top") position[2] += distance * POLE_NUDGE;
  else if (view === "bottom") position[2] -= distance * POLE_NUDGE;

  return position;
}
