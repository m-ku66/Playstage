import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Small label rendered inside the field, e.g. an axis letter. */
  prefix?: string;
  title?: string;
}

/**
 * A numeric input that does not fight the person typing into it.
 *
 * A plain controlled input bound straight to store state breaks down here,
 * because the store clamps. Clear the field to retype a width and the empty
 * string parses as 0, clamps to the minimum, and the input snaps to "0.01"
 * mid-keystroke. Same for typing "-" before a number, or a lone ".".
 *
 * So the field keeps its own draft string. Edits commit upward whenever the
 * draft parses to a finite number, but the displayed text stays exactly what
 * was typed until focus leaves -- at which point it resyncs to whatever the
 * store actually settled on, which is how a clamp becomes visible.
 */
export function NumberField({
  value,
  onCommit,
  step = 0.1,
  min,
  max,
  prefix,
  title,
}: Props) {
  const [draft, setDraft] = useState(() => format(value));
  const focused = useRef(false);

  // Track external changes (gizmo drag, undo, clamping) but never yank the
  // text out from under someone mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(format(value));
  }, [value]);

  return (
    <label
      title={title}
      className="flex items-center gap-1 rounded-md border border-stage-line bg-stage-field px-1.5 py-1 transition-colors focus-within:border-stage-accent focus-within:bg-stage-panel"
    >
      {prefix && (
        <span className="shrink-0 font-mono text-[10px] text-stage-faint">
          {prefix}
        </span>
      )}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          // Show what the store kept, not what was typed.
          setDraft(format(value));
        }}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const parsed = Number(text);
          // "" parses as 0 and "1e" as NaN -- neither is an edit worth
          // committing, so leave the store alone until the draft is a number.
          if (text.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full min-w-0 bg-transparent font-mono text-[12px] text-stage-ink outline-none"
      />
    </label>
  );
}

/** Trims float noise without truncating values someone deliberately typed. */
function format(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(4)));
}
