import type { ReactNode } from "react";

/**
 * Small layout primitives shared by the side panels.
 *
 * Extracted from Inspector so MaterialPanel can use them too. Importing them
 * back out of Inspector would make the two files import each other, which is a
 * cycle the bundler tolerates and nobody enjoys debugging.
 */

/** A labelled row. The label is the uppercase micro-caps used throughout. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Full-width text button, for actions that apply to the whole panel. */
export function PanelButton({
  label,
  title,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`w-full rounded-md border border-stage-line bg-stage-field px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-default disabled:opacity-40 ${
        danger
          ? "text-stage-muted hover:border-stage-warn hover:text-stage-warn"
          : "text-stage-muted hover:border-stage-accent hover:text-stage-accent"
      }`}
    >
      {label}
    </button>
  );
}
