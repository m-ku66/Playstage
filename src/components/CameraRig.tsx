import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { ViewName } from "../scene/views";
import {
  OPPOSITE_VIEW,
  cameraPositionFor,
  nearestView,
} from "../scene/views";
import type { CameraRequest } from "../store/cameraStore";
import { useCameraStore } from "../store/cameraStore";
import { clampFov } from "../scene/hotspots";

/**
 * The active camera, and the commands that move it.
 *
 * Two jobs that have to live together: swapping between a perspective and an
 * orthographic camera, and snapping to an axis view. They interact, because a
 * projection switch replaces the camera object and the new one has to be put
 * back where the old one was.
 */

const INITIAL_POSITION: [number, number, number] = [6, 5, 8];
/** Fallback when the camera is sitting exactly on its target. */
const FALLBACK_DISTANCE = 12;

const ORIGIN = new THREE.Vector3();
/** Reused so applying a view allocates nothing. */
const offsetScratch = new THREE.Vector3();

/** The parts of OrbitControls this needs, without depending on its types. */
interface OrbitLike {
  target?: THREE.Vector3;
  update?: () => void;
}

export function CameraRig() {
  const orthographic = useCameraStore((s) => s.orthographic);
  const zoom = useCameraStore((s) => s.zoom);

  return (
    <>
      {orthographic ? (
        <OrthographicCamera
          makeDefault
          position={INITIAL_POSITION}
          zoom={zoom}
          // A negative near plane so geometry between the camera and its
          // target is never clipped away. In an axis view -- which is where
          // orthographic earns its keep -- the camera often ends up inside
          // the bounds of what you are drawing.
          near={-2000}
          far={4000}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          position={INITIAL_POSITION}
          fov={50}
          near={0.1}
          far={2000}
        />
      )}
      <CameraCommands orthographic={orthographic} />
    </>
  );
}

function CameraCommands({ orthographic }: { orthographic: boolean }) {
  const invalidate = useThree((s) => s.invalidate);

  const lastPosition = useRef(new THREE.Vector3(...INITIAL_POSITION));
  const lastTarget = useRef(new THREE.Vector3());
  /**
   * Frames left to keep re-applying the saved camera after a projection
   * switch.
   *
   * More than one, because OrbitControls rebuilds itself around the new camera
   * and there is no guarantee state.controls points at the finished new
   * instance on the very first frame. Restoring twice costs nothing -- the
   * user cannot interact inside two frames -- and removes the race.
   */
  const restoreFrames = useRef(0);

  const pending = useCameraStore((s) => s.pending);

  // frameloop is "demand", so a store change draws nothing by itself. Both a
  // view request and a projection switch have to ask for a frame.
  useEffect(() => {
    if (pending) invalidate();
  }, [pending, invalidate]);

  useEffect(() => {
    // React has just swapped the camera object. The restore happens inside
    // useFrame rather than here on purpose: a frame callback receives the
    // live state, so state.camera is definitely the NEW camera, whereas an
    // effect would depend on the order sibling effects happen to run in.
    restoreFrames.current = 2;
    invalidate();
  }, [orthographic, invalidate]);

  useFrame((state) => {
    const camera = state.camera;
    const controls = state.controls as OrbitLike | null;

    if (restoreFrames.current > 0) {
      restoreFrames.current -= 1;
      camera.position.copy(lastPosition.current);
      // OrbitControls recreates itself around the new camera with its target
      // back at the origin, so that has to be put back too, or panning away
      // from the origin would be undone by toggling projection.
      if (controls?.target) controls.target.copy(lastTarget.current);
      camera.lookAt(lastTarget.current);
      controls?.update?.();
      // Keep asking for frames until the restore has finished, or demand mode
      // would stop drawing halfway through it.
      if (restoreFrames.current > 0) invalidate();
      return;
    }

    const request = useCameraStore.getState().pending;
    if (request) {
      applyRequest(camera, controls, request);
      useCameraStore.getState().clearPending();
      return;
    }

    // Remembered every quiet frame, so a projection switch has somewhere to
    // put the camera back to.
    lastPosition.current.copy(camera.position);
    lastTarget.current.copy(controls?.target ?? ORIGIN);
  });

  return null;
}

function applyRequest(
  camera: THREE.Camera,
  controls: OrbitLike | null,
  request: CameraRequest,
) {
  // A saved angle is an absolute pose: position, what it looks at, and the
  // lens. Nothing about the current camera is preserved, which is the point --
  // the whole hotspot is being restored.
  if (request.kind === "pose") {
    camera.position.set(
      request.position[0],
      request.position[1],
      request.position[2],
    );

    if (controls?.target) {
      controls.target.set(request.target[0], request.target[1], request.target[2]);
    }

    // Only meaningful under perspective. An orthographic camera has no field
    // of view, so a hotspot's lens is simply not applied until you switch
    // back -- rather than silently writing a value nothing reads.
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      const fov = clampFov(request.fov);
      if (perspective.fov !== fov) {
        perspective.fov = fov;
        perspective.updateProjectionMatrix();
      }
    }

    camera.lookAt(request.target[0], request.target[1], request.target[2]);
    controls?.update?.();
    return;
  }

  const target = controls?.target ?? ORIGIN;

  let resolved: ViewName;
  if (request.kind === "flip") {
    // Read off the camera's actual direction rather than remembering which
    // button was pressed last, so flipping still means something sensible
    // after the user has orbited away by hand.
    offsetScratch.copy(camera.position).sub(target);
    resolved =
      OPPOSITE_VIEW[
        nearestView([offsetScratch.x, offsetScratch.y, offsetScratch.z])
      ];
  } else {
    resolved = request.view;
  }

  // Preserved, so snapping to a view does not also change how far out you
  // were zoomed.
  const distance = camera.position.distanceTo(target) || FALLBACK_DISTANCE;

  const [x, y, z] = cameraPositionFor(
    resolved,
    [target.x, target.y, target.z],
    distance,
  );
  camera.position.set(x, y, z);
  camera.lookAt(target);
  controls?.update?.();
}
