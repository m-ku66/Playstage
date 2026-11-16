import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { childrenByParent } from "../geometry/transforms";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useTextureStore } from "../store/textureStore";
import { SceneObjectView } from "./SceneObjectView";
import { SelectionGizmo } from "./SelectionGizmo";
import { CameraRig } from "./CameraRig";
import { GroundRuler } from "./GroundRuler";
import { ViewportProbe } from "./ViewportProbe";
import { RulerOverlay } from "./RulerOverlay";

/** Light-theme viewport palette. Kept here rather than in CSS because these
 *  values are consumed by WebGL, not by the DOM. */
const VIEWPORT_BG = "#f2f2f0";
const GRID_CELL_COLOR = "#dcdcd7";
const GRID_SECTION_COLOR = "#bfbfb8";

/**
 * Asks for a frame when a texture finishes decoding.
 *
 * `frameloop="demand"` means the canvas only draws when something tells it to.
 * An image load resolves from a promise, outside the render that started it, so
 * the frame that would show the newly textured face has to be requested -- the
 * same rule the transform gizmo follows. One component watching the cache
 * rather than an effect per object: a scene can hold hundreds of objects and
 * they would all be asking for the same single frame.
 */
function TextureInvalidator() {
  const invalidate = useThree((s) => s.invalidate);
  const entries = useTextureStore((s) => s.entries);

  useEffect(() => {
    invalidate();
  }, [entries, invalidate]);

  return null;
}

/** Renders only root objects; each one recurses into its own children. */
function SceneTree() {
  const objects = useSceneStore((s) => s.objects);
  const childrenOf = useMemo(() => childrenByParent(objects), [objects]);
  const roots = childrenOf.get(null) ?? [];

  return (
    <>
      {roots.map((o) => (
        <SceneObjectView
          key={o.id}
          object={o}
          childrenOf={childrenOf}
          // A root object is its own pick target, and only its lock can make
          // a subtree unpickable -- both values are inherited downward from
          // here by every descendant.
          pickRootId={o.id}
          pickBlocked={o.locked}
          ancestorSelected={false}
        />
      ))}
    </>
  );
}

/**
 * The 3D viewport.
 *
 * `frameloop="demand"` is the single biggest stability win here: the canvas
 * only re-renders when something actually changes (a store update, an orbit
 * drag) instead of burning a full 60fps render loop on a static scene.
 * Anything that animates outside React's render cycle -- the transform gizmo,
 * for one -- has to call invalidate() itself.
 *
 * `preserveDrawingBuffer` is on because PNG export later reads the canvas back
 * with toDataURL, which returns a blank image without it.
 *
 * The ruler numbers are a sibling DOM overlay rather than part of the scene,
 * which is why this returns a positioned wrapper instead of a bare Canvas.
 */
export function Viewport() {
  const select = useEditorStore((s) => s.select);
  const isDragging = useEditorStore((s) => s.isDragging);

  return (
    <div className="relative h-full w-full">
      <Canvas
        frameloop="demand"
        // Explicit shadow type rather than a bare `shadows`. R3F's default is
        // PCFSoftShadowMap, which three no longer ships -- it warns and falls
        // back to PCFShadowMap. Naming the one we actually get means an
        // upgrade cannot quietly change how shadows look, and the console
        // stays clean enough that a real warning is visible in it.
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 2]}
        // No camera prop: CameraRig owns the camera, because the projection
        // can be switched at runtime and the Canvas prop only applies once.
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        // Clicking empty space clears the selection -- but not when the click
        // was the end of a gizmo drag that happened to miss a mesh, and not
        // when shift is held, since an additive modifier should never be the
        // thing that throws a selection away.
        onPointerMissed={(e) => {
          if (useEditorStore.getState().isDragging) return;
          if (e.shiftKey) return;
          select(null);
        }}
        style={{ background: VIEWPORT_BG }}
      >
        {/* Soft, even key light — reads closer to a drafting reference than a
            dramatic render, which is what background previz actually wants. */}
        <hemisphereLight args={["#ffffff", "#d9d9d4", 2.0]} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
        />

        <Grid
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.7}
          cellColor={GRID_CELL_COLOR}
          sectionSize={5}
          sectionThickness={1.2}
          sectionColor={GRID_SECTION_COLOR}
          fadeDistance={70}
          fadeStrength={1}
          infiniteGrid
          followCamera={false}
        />

        <CameraRig />
        <GroundRuler />
        <SceneTree />
        <SelectionGizmo />
        <ViewportProbe />
        <TextureInvalidator />

        {/* makeDefault lets TransformControls find and disable orbiting while a
            gizmo handle is being dragged, and publishes the orbit target that
            ViewportProbe measures the focus distance against. */}
        <OrbitControls
          makeDefault
          enabled={!isDragging}
          enableDamping
          dampingFactor={0.12}
        />
      </Canvas>

      <RulerOverlay />
    </div>
  );
}
