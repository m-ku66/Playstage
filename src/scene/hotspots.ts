import type { CameraHotspot, Vec3 } from "../types/scene";

/**
 * Saved camera angles.
 *
 * A hotspot is a position, the point it looks at, and a field of view. Stored
 * as a look-at target rather than a quaternion on purpose: it stays readable
 * in the scene file and editable by hand, and it is what OrbitControls wants
 * back when restoring the view.
 *
 * The point of these for a background blockout is that one scene serves every
 * panel on a page -- build the room once, then save the three angles the
 * sequence needs and flick between them.
 */

/**
 * Field of view limits.
 *
 * Narrower than 10 degrees is a telephoto so flat it stops reading as a space
 * at all; wider than 120 bends straight edges hard enough to be useless as a
 * drawing reference. These bound both the inspector input and anything
 * arriving from a scene file.
 */
export const FOV_MIN = 10;
export const FOV_MAX = 120;
export const FOV_DEFAULT = 50;

export function clampFov(value: number): number {
  if (!Number.isFinite(value)) return FOV_DEFAULT;
  return Math.min(FOV_MAX, Math.max(FOV_MIN, value));
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/**
 * Builds a hotspot from a captured pose.
 *
 * Copies the vectors rather than storing the references it was handed: the
 * caller's pose comes from a live store that is overwritten every frame, and
 * keeping a reference to it would leave every saved hotspot silently tracking
 * the current camera.
 */
export function makeHotspot(
  id: string,
  name: string,
  pose: CameraPose,
): CameraHotspot {
  return {
    id,
    name,
    position: [...pose.position],
    target: [...pose.target],
    fov: clampFov(pose.fov),
  };
}
