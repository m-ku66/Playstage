import { create } from "zustand";

/**
 * Where the current scene lives on disk, and whether an IO operation is in
 * flight.
 *
 * Separate from sceneStore for the same reason editorStore is: this is not
 * part of the document. Undoing an edit must not move the file, and the path
 * is not something that belongs inside the saved file itself.
 *
 * `busy` exists to make save and open non-reentrant. Hammering Ctrl+S during
 * a slow write to a synced folder would otherwise start overlapping writes to
 * the same path.
 */

interface DocumentState {
  /** Absolute path of the current scene, or null if never saved. */
  filePath: string | null;
  /** True while a save or open is running. */
  busy: boolean;

  setFilePath: (filePath: string | null) => void;
  setBusy: (busy: boolean) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  busy: false,

  setFilePath: (filePath) => set({ filePath }),
  setBusy: (busy) => set({ busy }),
}));
