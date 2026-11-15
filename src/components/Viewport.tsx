import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { childrenByParent } from "../geometry/transforms";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { SceneObjectView } from "./SceneObjectView";
import { SelectionGizmo } from "./SelectionGizmo";

/** Light-theme viewport palette. Kept here rather than in CSS because these
 *  values are consumed by WebGL, not by the DOM. */
const VIEWPORT_BG = "#f2f2f0";
const GRID_CELL_COLOR = "#dcdcd7";
const GRID_SECTION_COLOR = "#bfbfb8";

/** Renders only root objects; each one recurses into its own children. */
function SceneTree() {
  const objects = useSceneStore((s) => s.objects);
  const childrenOf = useMemo(() => childrenByParent(objects), [objects]);
  const roots = childrenOf.get(null) ?? [];

  return (
    <>
      {roots.map((o) => (
        <SceneObjectView key={o.id} object={o} childrenOf={childrenOf} />
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
 */
export function Viewport() {
  const select = useEditorStore((s) => s.select);
  const isDragging = useEditorStore((s) => s.isDragging);

  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      camera={{ position: [6, 5, 8], fov: 50, near: 0.1, far: 2000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      // Clicking empty space clears selection -- but not when the click was
      // the end of a gizmo drag that happened to miss a mesh.
      onPointerMissed={() => {
        if (!useEditorStore.getState().isDragging) select(null);
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

      <SceneTree />
      <SelectionGizmo />

      {/* makeDefault lets TransformControls find and disable orbiting while a
          gizmo handle is being dragged. */}
      <OrbitControls
        makeDefault
        enabled={!isDragging}
        enableDamping
        dampingFactor={0.12}
      />
    </Canvas>
  );
}
