import type { CameraHotspot } from "../types/scene";
import type { CameraPose } from "../scene/hotspots";
import { FOV_DEFAULT, FOV_MAX, FOV_MIN } from "../scene/hotspots";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useCameraStore } from "../store/cameraStore";
import { useViewStore } from "../store/viewStore";
import { NumberField } from "./NumberField";

/**
 * Saved camera angles.
 *
 * The reason these exist: one scene serves a whole page. Build the room once,
 * save the three angles the sequence needs, then flick between them instead of
 * re-framing by hand for every panel.
 *
 * Capture reads the live camera out of viewStore at the moment of the click.
 * Deliberately not subscribed: those values are rewritten every frame, so a
 * component that re-rendered on each of them would re-render all through an
 * orbit for no reason.
 */
export function HotspotPanel() {
  const hotspots = useSceneStore((s) => s.hotspots);
  const addHotspot = useSceneStore((s) => s.addHotspot);
  const updateHotspot = useSceneStore((s) => s.updateHotspot);
  const renameHotspot = useSceneStore((s) => s.renameHotspot);
  const setHotspotFov = useSceneStore((s) => s.setHotspotFov);
  const deleteHotspot = useSceneStore((s) => s.deleteHotspot);

  const activeId = useEditorStore((s) => s.activeHotspotId);
  const setActiveHotspot = useEditorStore((s) => s.setActiveHotspot);

  const requestPose = useCameraStore((s) => s.requestPose);
  const orthographic = useCameraStore((s) => s.orthographic);

  /** The camera exactly as it is now. Called on click, never held onto. */
  const capture = (): CameraPose => {
    const view = useViewStore.getState();
    return {
      position: view.cameraPosition,
      target: view.cameraTarget,
      // An orthographic camera has no field of view, so the probe reports
      // zero. Save a sensible lens rather than an impossible one, so the
      // angle still works when you switch back to perspective.
      fov: view.fov > 0 ? view.fov : FOV_DEFAULT,
    };
  };

  const goTo = (hotspot: CameraHotspot) => {
    setActiveHotspot(hotspot.id);
    requestPose({
      position: hotspot.position,
      target: hotspot.target,
      fov: hotspot.fov,
    });
  };

  return (
    <section className="flex min-h-0 flex-[3] flex-col">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint">
          Views
        </span>
        <button
          onClick={() => addHotspot(capture())}
          title="Save the current camera angle"
          className="rounded-md px-1.5 py-0.5 text-[11px] text-stage-muted transition-colors hover:bg-stage-accent-soft hover:text-stage-accent"
        >
          + Save
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {hotspots.length === 0 && (
          <p className="px-2 py-2 text-[11px] leading-relaxed text-stage-faint">
            No saved angles yet. Frame a shot in the viewport, then press Save.
          </p>
        )}

        {hotspots.map((hotspot, index) => {
          const active = hotspot.id === activeId;

          return (
            <div key={hotspot.id}>
              <div
                className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                  active
                    ? "bg-stage-accent-soft text-stage-accent"
                    : "text-stage-ink hover:bg-stage-field"
                }`}
              >
                <button
                  onClick={() => goTo(hotspot)}
                  title="Go to this angle"
                  className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                >
                  <span className="shrink-0 font-mono text-[10px] text-stage-faint">
                    {index + 1}
                  </span>
                  <span className="truncate">{hotspot.name}</span>
                </button>

                <button
                  onClick={() => updateHotspot(hotspot.id, capture())}
                  title="Recapture from the current camera, keeping the name"
                  className="invisible shrink-0 text-[11px] leading-none text-stage-faint transition-colors group-hover:visible hover:text-stage-ink"
                >
                  ⟲
                </button>
                <button
                  onClick={() => deleteHotspot(hotspot.id)}
                  title="Delete this angle"
                  className="invisible shrink-0 text-[11px] leading-none text-stage-faint transition-colors group-hover:visible hover:text-stage-warn"
                >
                  ✕
                </button>
              </div>

              {active && (
                <div className="mx-1 mb-1 mt-0.5 space-y-1.5 rounded-md bg-stage-field px-2 py-2">
                  <input
                    value={hotspot.name}
                    onChange={(e) => renameHotspot(hotspot.id, e.target.value)}
                    className="w-full rounded-md border border-stage-line bg-stage-panel px-2 py-1 text-[12px] text-stage-ink outline-none transition-colors focus:border-stage-accent"
                  />

                  <div className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] text-stage-muted">
                      FOV
                    </span>
                    <div className="min-w-0 flex-1">
                      <NumberField
                        value={hotspot.fov}
                        step={1}
                        min={FOV_MIN}
                        max={FOV_MAX}
                        title={`${FOV_MIN} – ${FOV_MAX} degrees`}
                        onCommit={(v) => setHotspotFov(hotspot.id, v)}
                      />
                    </div>
                  </div>

                  {orthographic && (
                    <p className="text-[10px] leading-snug text-stage-faint">
                      Field of view is ignored while the view is orthographic.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
