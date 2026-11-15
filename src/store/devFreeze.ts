/**
 * Development-only guard against accidental in-place mutation.
 *
 * Undo/redo stores snapshots that hold *references* to scene objects rather
 * than deep copies. That is only safe because every store action replaces
 * objects instead of editing them:
 *
 *     objects.map(o => o.id === id ? { ...o, name } : o)   // correct
 *     o.name = name                                        // corrupts history
 *
 * The second form reaches through every history entry that holds a reference
 * to `o` and rewrites what those entries "remember". The symptom is "undo is
 * flaky sometimes", which points nowhere near the cause.
 *
 * Freezing the document after every state change turns that silent corruption
 * into an immediate TypeError at the exact offending line. Stripped from
 * production builds, so it costs nothing shipped.
 */

/**
 * Freezes a value and everything reachable from it.
 *
 * Children are frozen before their parent, which establishes the invariant
 * "frozen parent implies frozen descendants". That lets the early return skip
 * whole subtrees: after a transform edit, the 99 untouched objects in a
 * 100-object scene are already frozen and cost one check each. Only the newly
 * created object is actually walked.
 *
 * The invariant assumes nothing else in the app calls Object.freeze on scene
 * data. Nothing does.
 */
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Object.isFrozen(value)) return;

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }

  Object.freeze(value);
}

/**
 * Freezes the document slice of a scene state. Editor state (selection, gizmo
 * mode) is deliberately left alone -- it is not snapshotted, so mutating it
 * cannot corrupt anything.
 */
export function freezeDocument(state: {
  objects: unknown;
  hotspots: unknown;
  textures: unknown;
}): void {
  deepFreeze(state.objects);
  deepFreeze(state.hotspots);
  deepFreeze(state.textures);
}

/** True in `vite dev`, false in a production build. */
export const FREEZE_ENABLED = import.meta.env.DEV;
