import { useMemo } from "react";
import { RULER_HALF_EXTENT, groundTicks } from "../scene/units";
import { useEditorStore } from "../store/editorStore";

/**
 * Tick marks along the X and Z axes, drawn on the ground plane.
 *
 * Geometrically honest: each mark sits at the world position its label names,
 * so it stays correct from any camera angle. The numbers themselves are DOM
 * (see RulerOverlay) -- these are just the marks.
 *
 * One lineSegments for the whole ruler, so it costs a single draw call
 * however many ticks there are. No pointer handlers, which is what keeps it
 * out of R3F's event path: a ruler must never swallow a click meant for an
 * object, or block a click on empty space from clearing the selection.
 */

const RULER_COLOR = "#8d93a1";
/** Half-length of a tick mark, in world units. */
const TICK_HALF = 0.22;
/** Lifted off the floor so it does not z-fight with the grid. */
const Y_OFFSET = 0.002;

export function GroundRuler() {
  const show = useEditorStore((s) => s.showGroundRuler);
  const unitSystem = useEditorStore((s) => s.unitSystem);

  const positions = useMemo(() => {
    const points: number[] = [];
    const extent = RULER_HALF_EXTENT;

    // The two axis lines.
    points.push(-extent, 0, 0, extent, 0, 0);
    points.push(0, 0, -extent, 0, 0, extent);

    for (const t of groundTicks(unitSystem)) {
      if (Math.abs(t) < 1e-6) continue;
      // Perpendicular to the axis it marks.
      points.push(t, 0, -TICK_HALF, t, 0, TICK_HALF);
      points.push(-TICK_HALF, 0, t, TICK_HALF, 0, t);
    }

    return new Float32Array(points);
  }, [unitSystem]);

  if (!show) return null;

  return (
    <lineSegments position={[0, Y_OFFSET, 0]} renderOrder={2}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={RULER_COLOR} depthWrite={false} />
    </lineSegments>
  );
}
