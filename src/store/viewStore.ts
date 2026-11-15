import { create } from "zustand";
import type { Vec3 } from "../types/scene";

/**
 * Measurements read back out of the live 3D view.
 *
 * The rulers are DOM, not WebGL: numbers stay upright and crisp instead of
 * foreshortening away at a shallow camera angle, and they can never intercept
 * a click meant for an object. But the values they need -- how many pixels a
 * world unit currently covers, and where each ground tick lands on screen --
 * only exist inside the Canvas, where the camera and viewport size live.
 *
 * So ViewportProbe computes them on the frames that render and publishes them
 * here, and the overlay outside the Canvas reads them. Derived view state:
 * never saved, never undone.
 */

export interface ProjectedTick {
  /** Screen position in CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  /** The number to print. */
  text: string;
  axis: "x" | "z";
}

export interface ViewMeasurements {
  /**
   * Screen pixels per world unit, measured at the camera's focus distance.
   *
   * Only exactly right at that depth -- that is the nature of a perspective
   * camera, and why the edge strips report the depth they were measured at
   * instead of pretending to be a universal scale. Zero when unknown.
   */
  pixelsPerUnit: number;
  /** Distance from the camera to its orbit target, in world units. */
  focusDistance: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Ground ruler ticks, already projected to screen space. */
  ticks: ProjectedTick[];

  /**
   * The live camera pose.
   *
   * Published so "save this angle" can be a plain button outside the Canvas.
   * Read it with getState() at the moment of capture -- these are overwritten
   * every frame, so anything that keeps a reference ends up tracking the
   * current camera instead of the angle it meant to save.
   */
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  /** Degrees. Zero while the camera is orthographic. */
  fov: number;
}

interface ViewState extends ViewMeasurements {
  publish: (next: ViewMeasurements) => void;
}

/** World-space tolerance below which a camera move is not worth publishing. */
const POSE_EPSILON = 1e-4;

function sameVec(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) < POSE_EPSILON &&
    Math.abs(a[1] - b[1]) < POSE_EPSILON &&
    Math.abs(a[2] - b[2]) < POSE_EPSILON
  );
}

/** Ignores sub-pixel jitter, so orbiting does not re-render the overlay for
 *  changes nobody can see. */
function unchanged(a: ViewMeasurements, b: ViewMeasurements): boolean {
  if (Math.abs(a.pixelsPerUnit - b.pixelsPerUnit) > 0.01) return false;
  if (Math.abs(a.focusDistance - b.focusDistance) > 0.01) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (Math.abs(a.fov - b.fov) > 1e-6) return false;
  // Orbiting at a constant distance changes neither the scale nor the tick
  // positions much, but it absolutely changes the pose -- and capturing a
  // hotspot has to see the angle you are actually looking from.
  if (!sameVec(a.cameraPosition, b.cameraPosition)) return false;
  if (!sameVec(a.cameraTarget, b.cameraTarget)) return false;
  if (a.ticks.length !== b.ticks.length) return false;

  for (let i = 0; i < a.ticks.length; i++) {
    const x = a.ticks[i];
    const y = b.ticks[i];
    if (x.text !== y.text || x.axis !== y.axis) return false;
    if (Math.abs(x.x - y.x) > 0.5 || Math.abs(x.y - y.y) > 0.5) return false;
  }
  return true;
}

export const useViewStore = create<ViewState>((set, get) => ({
  pixelsPerUnit: 0,
  focusDistance: 0,
  width: 0,
  height: 0,
  ticks: [],
  cameraPosition: [6, 5, 8],
  cameraTarget: [0, 0, 0],
  fov: 50,

  publish: (next) => {
    if (unchanged(get(), next)) return;
    set(next);
  },
}));
