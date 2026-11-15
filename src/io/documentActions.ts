import { useSceneStore } from "../store/sceneStore";
import { useDocumentStore } from "../store/documentStore";
import { SceneFileError, parseSceneFile, serializeScene } from "./sceneFile";
import {
  NotDesktopError,
  basename,
  confirmDiscard,
  isDesktop,
  pickSavePath,
  pickScenePath,
  readTextFile,
  showError,
  showInfo,
  writeTextFile,
} from "./nativeFs";

/**
 * New / Open / Save, as plain async functions rather than store actions.
 *
 * They coordinate three stores and the filesystem, which is more than any one
 * store should know about. Keeping them outside the stores also keeps them
 * callable from a toolbar button, a keyboard shortcut and (later) a window
 * close handler without duplicating the sequencing.
 *
 * Every one of them resolves to a boolean: true if it ran to completion, false
 * if the user cancelled or it failed. Callers that chain operations -- "save
 * before closing" -- need to be able to tell those apart.
 */

/* ------------------------------------------------------------------ */
/* Shared plumbing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Runs an operation with the busy flag held, so two saves cannot interleave.
 *
 * Writes to a OneDrive folder can take a noticeable moment, and this project
 * lives in one. Without the guard, leaning on Ctrl+S would start overlapping
 * writes to the same path.
 */
async function exclusive<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  const doc = useDocumentStore.getState();
  if (doc.busy) return fallback;

  doc.setBusy(true);
  try {
    return await fn();
  } finally {
    useDocumentStore.getState().setBusy(false);
  }
}

/** Turns any thrown value into a message worth showing the user. */
function explain(err: unknown): string {
  if (err instanceof SceneFileError || err instanceof NotDesktopError) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  // Rust commands reject with a plain string, not an Error.
  if (typeof err === "string") return err;
  return "An unexpected error occurred.";
}

/**
 * Asks before throwing away unsaved work.
 *
 * Returns true when it is safe to proceed. Note the deliberate asymmetry: in
 * a plain browser (no dialog available) confirmDiscard returns false, so an
 * unsaved scene is never silently discarded during `npm run dev`.
 */
async function okToDiscard(action: string): Promise<boolean> {
  if (!useSceneStore.getState().dirty) return true;
  return confirmDiscard(
    `"${useSceneStore.getState().sceneName}" has unsaved changes. ${action}`,
  );
}

/* ------------------------------------------------------------------ */
/* New                                                                 */
/* ------------------------------------------------------------------ */

export async function newScene(): Promise<boolean> {
  if (!(await okToDiscard("Start a new scene anyway?"))) return false;

  useSceneStore.getState().newScene();
  useDocumentStore.getState().setFilePath(null);
  return true;
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

/** Writes to the current path, or falls through to Save As if there isn't one. */
export async function saveScene(): Promise<boolean> {
  const path = useDocumentStore.getState().filePath;
  if (!path) return saveSceneAs();

  return exclusive(async () => {
    try {
      await writeTextFile(path, serializeScene(useSceneStore.getState().toSceneFile()));
      // Only after the write resolves. Clearing the dirty flag optimistically
      // would show a saved scene that isn't on disk.
      useSceneStore.getState().markSaved();
      return true;
    } catch (err) {
      await showError("Could not save scene", explain(err));
      return false;
    }
  }, false);
}

export async function saveSceneAs(): Promise<boolean> {
  if (!isDesktop()) {
    await showError("Could not save scene", new NotDesktopError().message);
    return false;
  }

  // The picker opens outside the busy guard: it blocks on the user, and
  // holding the flag through it would wedge every shortcut behind the dialog.
  let path: string | null;
  try {
    path = await pickSavePath(useSceneStore.getState().sceneName);
  } catch (err) {
    await showError("Could not save scene", explain(err));
    return false;
  }
  if (!path) return false;

  const chosen = path;
  return exclusive(async () => {
    const scene = useSceneStore.getState();
    // Rename the document to match the file before serialising, so the name
    // stored inside the file agrees with the name on disk.
    scene.setSceneName(basename(chosen));

    try {
      await writeTextFile(
        chosen,
        serializeScene(useSceneStore.getState().toSceneFile()),
      );
      useSceneStore.getState().markSaved();
      useDocumentStore.getState().setFilePath(chosen);
      return true;
    } catch (err) {
      await showError("Could not save scene", explain(err));
      return false;
    }
  }, false);
}

/* ------------------------------------------------------------------ */
/* Open                                                                */
/* ------------------------------------------------------------------ */

export async function openSceneFromPath(path: string): Promise<boolean> {
  return exclusive(async () => {
    try {
      const text = await readTextFile(path);
      const { file, warnings } = parseSceneFile(text);

      useSceneStore.getState().loadScene(file);
      // Prefer the filename over the name stored inside the file: it is what
      // the user sees in Explorer, and the two can diverge after a rename.
      useSceneStore.getState().setSceneName(basename(path));
      useSceneStore.getState().markSaved();
      useDocumentStore.getState().setFilePath(path);

      if (warnings.length > 0) {
        // Repairs are reported rather than applied silently. A scene that
        // quietly came back different is worse than one that explains itself.
        await showInfo(
          "Scene opened with repairs",
          `Playstage fixed some problems while opening this file:\n\n` +
            warnings.map((w) => `• ${w}`).join("\n"),
        );
      }
      return true;
    } catch (err) {
      await showError("Could not open scene", explain(err));
      return false;
    }
  }, false);
}

export async function openScene(): Promise<boolean> {
  if (!isDesktop()) {
    await showError("Could not open scene", new NotDesktopError().message);
    return false;
  }
  if (!(await okToDiscard("Open another scene anyway?"))) return false;

  let path: string | null;
  try {
    path = await pickScenePath();
  } catch (err) {
    await showError("Could not open scene", explain(err));
    return false;
  }
  if (!path) return false;

  return openSceneFromPath(path);
}
