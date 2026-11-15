import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEditorStore } from "../store/editorStore";
import { useViewStore, type ProjectedTick } from "../store/viewStore";
import { formatTickValue, groundTicks } from "../scene/units";

/**
 * Publishes view measurements for the ruler overlay. Renders nothing.
 *
 * Lives inside the Canvas because that is the only place the camera and the
 * drawing-buffer size exist. Reads the editor store through getState rather
 * than subscribing: this runs per frame and must not re-render on every
 * selection change.
 */

const ORIGIN = new THREE.Vector3();
/** Reused across every projection so a frame allocates nothing. */
const scratch = new THREE.Vector3();

/** How close to an edge a ground label may sit before it is dropped. */
const EDGE_MARGIN_PX = 28;

export function ViewportProbe() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as {
    target?: THREE.Vector3;
  } | null;

  useFrame(() => {
    const editor = useEditorStore.getState();

    // Orbiting moves the camera around its target, so the target is what the
    // user is actually looking at, and the depth any screen-space scale is
    // honest about.
    const target = controls?.target ?? ORIGIN;
    const focusDistance = camera.position.distanceTo(target);

    let pixelsPerUnit = 0;

    const perspective = camera as THREE.PerspectiveCamera;
    const orthographic = camera as THREE.OrthographicCamera;

    if (perspective.isPerspectiveCamera && focusDistance > 0) {
      const vFov = (perspective.fov * Math.PI) / 180;
      const visibleHeight = 2 * focusDistance * Math.tan(vFov / 2);
      if (visibleHeight > 0) pixelsPerUnit = size.height / visibleHeight;
    } else if (orthographic.isOrthographicCamera) {
      // Parallel projection, so this one scale is exact at every depth --
      // which is what makes the edge strips trustworthy in this mode. Read
      // from the frustum rather than assuming zoom alone, so it holds however
      // the camera's bounds were set.
      const frustumHeight =
        (orthographic.top - orthographic.bottom) / orthographic.zoom;
      if (frustumHeight > 0) pixelsPerUnit = size.height / frustumHeight;
    }

    const ticks: ProjectedTick[] = [];
    if (editor.showGroundRuler) {
      for (const t of groundTicks(editor.unitSystem)) {
        // The origin would stack an X and a Z label on the same pixel.
        if (Math.abs(t) < 1e-6) continue;
        project(ticks, t, 0, "x", t, editor.unitSystem, camera, size);
        project(ticks, 0, t, "z", t, editor.unitSystem, camera, size);
      }
    }

    useViewStore.getState().publish({
      pixelsPerUnit,
      focusDistance,
      width: size.width,
      height: size.height,
      ticks,
      cameraPosition: [
        camera.position.x,
        camera.position.y,
        camera.position.z,
      ],
      cameraTarget: [target.x, target.y, target.z],
      // Zero under an orthographic camera, which has no field of view.
      fov: perspective.isPerspectiveCamera ? perspective.fov : 0,
    });
  });

  return null;
}

function project(
  out: ProjectedTick[],
  worldX: number,
  worldZ: number,
  axis: "x" | "z",
  value: number,
  system: Parameters<typeof formatTickValue>[1],
  camera: THREE.Camera,
  size: { width: number; height: number },
) {
  scratch.set(worldX, 0, worldZ).project(camera);

  // NDC z above 1 is behind the near plane; projecting it gives a position
  // mirrored to the wrong side of the screen.
  if (scratch.z > 1) return;

  const x = (scratch.x * 0.5 + 0.5) * size.width;
  const y = (-scratch.y * 0.5 + 0.5) * size.height;

  if (x < EDGE_MARGIN_PX || x > size.width - EDGE_MARGIN_PX) return;
  if (y < EDGE_MARGIN_PX || y > size.height - EDGE_MARGIN_PX) return;

  out.push({ x, y, text: formatTickValue(value, system), axis });
}
