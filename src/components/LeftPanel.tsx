import { Outliner } from "./Outliner";
import { HotspotPanel } from "./HotspotPanel";
import { useEditorStore } from "../store/editorStore";

/**
 * The left sidebar: the scene tree above, saved camera angles below.
 *
 * Split 70/30 by flex weight rather than fixed heights, so both halves keep
 * working at any window size and each scrolls independently. `min-h-0` on both
 * is what actually makes that happen -- without it a flex child refuses to
 * shrink below its content and the overflow never kicks in, so the panel grows
 * past the window instead of scrolling.
 */
export function LeftPanel() {
  const setShortcutsOpen = useEditorStore((s) => s.setShortcutsOpen);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-stage-line bg-stage-panel">
      <Outliner />

      <div className="h-px shrink-0 bg-stage-line" />

      <HotspotPanel />

      {/* The full reference lives in a modal now. It took a permanent slice of
          the one panel that benefits from vertical space, to show something
          you read once a week. */}
      <div className="shrink-0 border-t border-stage-line px-2 py-2">
        <button
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts (?)"
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] text-stage-faint transition-colors hover:bg-stage-field hover:text-stage-ink"
        >
          <span>Keyboard shortcuts</span>
          <span className="font-mono text-[10px]">?</span>
        </button>
      </div>
    </aside>
  );
}
