import { useEditorStore } from "../store/editorStore";

/**
 * The keyboard reference, as a modal.
 *
 * It used to be pinned to the bottom of the outliner, where it took a
 * permanent slice of the only panel that benefits from vertical space. A
 * reference you read once a week does not need to be on screen always.
 *
 * Escape is handled centrally in useKeyboardShortcuts rather than here, so
 * there is one place that decides what Escape means at any moment.
 */

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "File",
    keys: [
      ["Ctrl+N", "New scene"],
      ["Ctrl+O", "Open scene"],
      ["Ctrl+S", "Save"],
      ["Ctrl+⇧S", "Save as"],
    ],
  },
  {
    title: "Camera",
    keys: [
      ["1 / 3 / 7", "Front / Right / Top"],
      ["Ctrl + 1 / 3 / 7", "Back / Left / Bottom"],
      ["9", "Flip to the opposite side"],
      ["5", "Perspective / orthographic"],
    ],
  },
  {
    title: "Selection",
    keys: [
      ["Click", "Select — a grouped object selects its group"],
      ["⇧ Click", "Add to or remove from the selection"],
      ["Esc", "Deselect everything"],
    ],
  },
  {
    title: "Transform",
    keys: [
      ["W / E / R", "Move / Rotate / Scale"],
      ["X", "Toggle snapping"],
    ],
  },
  {
    title: "Objects",
    keys: [
      ["Ctrl+G", "Group the selection"],
      ["Ctrl+⇧G", "Ungroup"],
      ["Ctrl+D", "Duplicate"],
      ["H", "Hide / show"],
      ["L", "Lock / unlock — stops it being clicked"],
      ["Del", "Delete"],
    ],
  },
  {
    title: "History",
    keys: [
      ["Ctrl+Z", "Undo"],
      ["Ctrl+⇧Z", "Redo"],
    ],
  },
];

export function ShortcutsModal() {
  const open = useEditorStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useEditorStore((s) => s.setShortcutsOpen);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <div
        onClick={() => setShortcutsOpen(false)}
        className="absolute inset-0 bg-stage-ink/15"
      />

      <div className="relative max-h-full w-[560px] overflow-y-auto rounded-xl border border-stage-line bg-stage-panel p-5 shadow-[0_20px_60px_rgba(0,0,0,0.16)]">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold tracking-tight text-stage-ink">
            Keyboard shortcuts
          </h2>
          <button
            onClick={() => setShortcutsOpen(false)}
            title="Close (Esc)"
            className="rounded-md px-2 py-1 text-[13px] leading-none text-stage-muted transition-colors hover:bg-stage-field hover:text-stage-ink"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-7 gap-y-4">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <div className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-stage-faint">
                {section.title}
              </div>
              <dl className="space-y-1">
                {section.keys.map(([key, label]) => (
                  <div key={key} className="flex items-baseline gap-2">
                    <dt className="w-[108px] shrink-0 font-mono text-[10px] text-stage-muted">
                      {key}
                    </dt>
                    <dd className="text-[11px] leading-snug text-stage-faint">
                      {label}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-5 border-t border-stage-line pt-3 text-[11px] leading-relaxed text-stage-faint">
          Camera keys work on the numpad as well as the number row, so a
          keyboard without a numpad is not shut out. Ctrl is Cmd on a Mac.
        </p>
      </div>
    </div>
  );
}
