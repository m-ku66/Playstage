import { create } from "zustand";
import type { Vec3 } from "../types/scene";
import type { CameraPose } from "../scene/hotspots";
import type { ViewName } from "../scene/views";
import { useViewStore } from "./viewStore";

/**
 * Camera commands and projection mode.
 *
 * The camera itself lives inside the Canvas, so this store does not hold it --
 * it holds *requests*. A toolbar button or a keypress queues one here, and
 * CameraRig applies it on the next frame, where it has the live camera and
 * orbit controls to work with.
 *
 * A nonce rather than just a view name, because asking for "front" twice in a
 * row is a real thing to do: after orbiting away, pressing 1 again should snap
 * back, and a plain value would look unchanged to React.
 */

/**
 * A queued camera move.
 *
 * A discriminated union rather than one shape with optional fields: snapping
 * to an axis view keeps your current distance, flipping has to read the camera
 * before it knows where to go, and restoring a hotspot sets an absolute pose.
 * Those are three different operations, not three settings.
 *
 * The nonce is what makes a repeat request work. Asking for "front" twice
 * running is a real thing to do -- orbit away, press 1 again -- and a plain
 * value would look unchanged to React.
 */
export type CameraRequest =
  | { kind: "view"; view: ViewName; nonce: number }
  | { kind: "flip"; nonce: number }
  | { kind: "pose"; position: Vec3; target: Vec3; fov: number; nonce: number };

interface CameraState {
  pending: CameraRequest | null;
  /**
   * Orthographic projection.
   *
   * Worth having for its own sake: parallel projection is what makes a front
   * view an actual elevation, with no perspective convergence to fight when
   * drawing over it. It also makes the edge rulers exact at every depth
   * instead of only at the focus plane.
   */
  orthographic: boolean;
  /**
   * Pixels per world unit for the orthographic camera.
   *
   * Seeded from the perspective view's measured scale at the moment of the
   * switch, so the framing carries over instead of jumping.
   */
  zoom: number;

  requestView: (view: ViewName) => void;
  flipView: () => void;
  /** Restores a saved camera angle. */
  requestPose: (pose: CameraPose) => void;
  clearPending: () => void;
  setOrthographic: (orthographic: boolean, zoom?: number) => void;
  /** Flips projection, carrying the current framing across the switch. */
  toggleOrthographic: () => void;
}

export const DEFAULT_ORTHO_ZOOM = 80;

export const useCameraStore = create<CameraState>((set, get) => ({
  pending: null,
  orthographic: false,
  zoom: DEFAULT_ORTHO_ZOOM,

  requestView: (view) =>
    set({
      pending: { kind: "view", view, nonce: (get().pending?.nonce ?? 0) + 1 },
    }),

  flipView: () =>
    set({ pending: { kind: "flip", nonce: (get().pending?.nonce ?? 0) + 1 } }),

  requestPose: (pose) =>
    set({
      pending: {
        kind: "pose",
        // Copied, because the pose may come straight out of a store that is
        // rewritten every frame.
        position: [...pose.position],
        target: [...pose.target],
        fov: pose.fov,
        nonce: (get().pending?.nonce ?? 0) + 1,
      },
    }),

  clearPending: () => set({ pending: null }),

  setOrthographic: (orthographic, zoom) =>
    set(zoom && zoom > 0 ? { orthographic, zoom } : { orthographic }),

  toggleOrthographic: () => {
    if (get().orthographic) {
      set({ orthographic: false });
      return;
    }

    // Seeded from what the perspective view was actually measuring at its
    // focus plane, so switching keeps the framing instead of jumping. For an
    // orthographic camera whose frustum is the canvas size, pixels per unit
    // IS the zoom, which makes this a direct handover.
    const measured = useViewStore.getState().pixelsPerUnit;
    set({
      orthographic: true,
      zoom: measured > 0 ? measured : DEFAULT_ORTHO_ZOOM,
    });
  },
}));
