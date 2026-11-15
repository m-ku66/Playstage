import { chooseEdgeStep, formatLength, unitSuffix } from "../scene/units";
import type { UnitSystem } from "../scene/units";
import { useEditorStore } from "../store/editorStore";
import { useViewStore } from "../store/viewStore";
import { useCameraStore } from "../store/cameraStore";

/**
 * The ruler numbers, drawn as DOM over the canvas.
 *
 * Two different things share this overlay, and they are honest about being
 * different:
 *
 *   - Ground labels sit at the projected screen position of a real world
 *     coordinate, so they are correct from any camera angle. ViewportProbe
 *     does the projecting.
 *   - Edge strips are a screen-space scale. Under a perspective camera there
 *     is no single scale for the whole image, so these are measured at the
 *     camera's focus distance and the strip says so, out loud, rather than
 *     implying a precision it does not have.
 *
 * The whole overlay is pointer-events-none. A ruler that ate clicks meant for
 * an object would be worse than no ruler.
 */

const BOTTOM_STRIP_PX = 22;
const LEFT_STRIP_PX = 38;

export function RulerOverlay() {
  const showGround = useEditorStore((s) => s.showGroundRuler);
  const showEdges = useEditorStore((s) => s.showEdgeRuler);
  const unitSystem = useEditorStore((s) => s.unitSystem);

  const ticks = useViewStore((s) => s.ticks);
  const pixelsPerUnit = useViewStore((s) => s.pixelsPerUnit);
  const focusDistance = useViewStore((s) => s.focusDistance);
  const width = useViewStore((s) => s.width);
  const height = useViewStore((s) => s.height);
  const orthographic = useCameraStore((s) => s.orthographic);

  if (!showGround && !showEdges) return null;

  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      <span className="absolute left-3 top-3 rounded bg-stage-panel/80 px-1.5 py-0.5 font-mono text-[10px] text-stage-muted">
        {unitSuffix(unitSystem)}
      </span>

      {showGround &&
        ticks.map((t) => (
          <span
            key={`${t.axis}:${t.text}`}
            style={{ left: t.x, top: t.y }}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-stage-panel/75 px-1 font-mono text-[10px] leading-tight text-stage-muted"
          >
            {t.text}
          </span>
        ))}

      {showEdges && (
        <EdgeStrips
          pixelsPerUnit={pixelsPerUnit}
          focusDistance={focusDistance}
          width={width}
          height={height}
          unitSystem={unitSystem}
          orthographic={orthographic}
        />
      )}
    </div>
  );
}

/** Tick indices either side of centre that still fit on a strip. */
function marksFrom(lengthPx: number, gap: number): number[] {
  const steps = Math.floor(lengthPx / 2 / gap);
  const out: number[] = [];
  for (let k = -steps; k <= steps; k++) out.push(k);
  return out;
}

function EdgeStrips({
  pixelsPerUnit,
  focusDistance,
  width,
  height,
  unitSystem,
  orthographic,
}: {
  pixelsPerUnit: number;
  focusDistance: number;
  width: number;
  height: number;
  unitSystem: UnitSystem;
  orthographic: boolean;
}) {
  if (pixelsPerUnit <= 0 || width <= 0 || height <= 0) return null;

  const step = chooseEdgeStep(pixelsPerUnit, unitSystem);
  const gap = step * pixelsPerUnit;
  if (!Number.isFinite(gap) || gap < 8) return null;

  // Measured outward from the centre of the screen, which is the point the
  // camera is focused on -- the one place the scale is exact.
  const label = (k: number) => formatLength(Math.abs(k) * step, unitSystem);

  return (
    <>
      <div
        className="absolute bottom-0 left-0 border-r border-stage-line bg-stage-panel/85"
        style={{ width: LEFT_STRIP_PX, top: 0, bottom: BOTTOM_STRIP_PX }}
      >
        {marksFrom(height, gap).map((k) => (
          <div
            key={k}
            style={{ top: height / 2 + k * gap }}
            className="absolute right-0 flex w-full -translate-y-1/2 items-center justify-end gap-1 pr-0.5"
          >
            <span className="font-mono text-[9px] leading-none text-stage-muted">
              {label(k)}
            </span>
            <span className="h-px w-1.5 bg-stage-line-strong" />
          </div>
        ))}
      </div>

      <div
        className="absolute inset-x-0 bottom-0 border-t border-stage-line bg-stage-panel/85"
        style={{ height: BOTTOM_STRIP_PX }}
      >
        {marksFrom(width, gap).map((k) => (
          <div
            key={k}
            style={{ left: width / 2 + k * gap }}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
          >
            <span className="h-1.5 w-px bg-stage-line-strong" />
            <span className="font-mono text-[9px] leading-none text-stage-muted">
              {label(k)}
            </span>
          </div>
        ))}

        {/* The caveat, stated where the numbers are -- and withdrawn when it
            no longer applies. A parallel projection has one scale everywhere,
            so in orthographic mode these strips are simply correct. */}
        <span className="absolute right-2 top-1/2 -translate-y-1/2 bg-stage-panel/90 pl-2 font-mono text-[9px] text-stage-faint">
          {orthographic
            ? "exact at any depth"
            : `scale at ${formatLength(focusDistance, unitSystem)} depth`}
        </span>
      </div>
    </>
  );
}
