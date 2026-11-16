import { invoke } from "@tauri-apps/api/core";
import {
  ask as dialogAsk,
  message as dialogMessage,
  open as dialogOpen,
  save as dialogSave,
} from "@tauri-apps/plugin-dialog";
import { SCENE_EXTENSION, SCENE_FILTER_NAME } from "./sceneFile";

/**
 * The only place that talks to the host OS.
 *
 * Everything here funnels through either the dialog plugin or one of the two
 * Rust commands in src-tauri/src/lib.rs. Keeping that surface in one small
 * file means the rest of the app never imports a Tauri API directly, so the
 * stores and components stay testable in plain Node.
 *
 * Reads and writes deliberately do NOT go through tauri-plugin-fs. That
 * plugin gates access with a compile-time path scope, which fights a file
 * picker whose paths are only known at runtime. The Rust side instead exposes
 * exactly two operations, neither of which can enumerate a directory, so
 * there is nothing here to walk outward from a path the user chose.
 */

/** True when running inside the Tauri shell rather than a plain browser tab. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Thrown when a file operation is attempted outside the desktop shell. */
export class NotDesktopError extends Error {
  constructor() {
    super(
      "File operations need the desktop app. Run `npm run tauri dev` rather " +
        "than `npm run dev` in a browser.",
    );
    this.name = "NotDesktopError";
  }
}

function requireDesktop() {
  if (!isDesktop()) throw new NotDesktopError();
}

const SCENE_FILTERS = [
  { name: SCENE_FILTER_NAME, extensions: [SCENE_EXTENSION] },
];

/** Kept in step with IMAGE_EXTENSIONS in src-tauri/src/lib.rs. The Rust side
 *  re-checks, so this list is a convenience for the picker rather than the
 *  thing enforcing it. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"] as const;

const IMAGE_FILTERS = [{ name: "Images", extensions: [...IMAGE_EXTENSIONS] }];

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
};

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/** Filename without its directory or extension. Handles both separators so
 *  the same code works on a Windows path and a posix one. */
export function basename(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Filename with its extension. Used for texture tray tooltips, where the
 *  extension is part of how you tell two exports of the same art apart. */
export function filename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Lowercased extension without the dot, or "" when there is none. */
export function extensionOf(path: string): string {
  const file = filename(path);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
}

/**
 * Mime type for a Blob built from an image file's bytes.
 *
 * The browser sniffs image content regardless, so an octet-stream Blob would
 * usually still decode -- but a correct type keeps it from ever being treated
 * as a download, and makes the failure mode of an unknown extension explicit.
 */
export function imageMimeType(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? "application/octet-stream";
}

/** Ensures the path ends in .playstage. Some platforms' save dialogs return
 *  the typed name verbatim when the user omits the extension. */
export function withSceneExtension(path: string): string {
  return path.toLowerCase().endsWith(`.${SCENE_EXTENSION}`)
    ? path
    : `${path}.${SCENE_EXTENSION}`;
}

/* ------------------------------------------------------------------ */
/* File IO                                                             */
/* ------------------------------------------------------------------ */

export async function readTextFile(path: string): Promise<string> {
  requireDesktop();
  return invoke<string>("read_text_file", { path });
}

export async function writeTextFile(
  path: string,
  contents: string,
): Promise<void> {
  requireDesktop();
  await invoke("write_text_file", { path, contents });
}

/**
 * Raw bytes of an image file, for decoding into a texture.
 *
 * The Rust command returns a `tauri::ipc::Response`, which arrives here as an
 * ArrayBuffer rather than going through JSON. See read_image_file in
 * src-tauri/src/lib.rs for why that matters.
 */
export async function readImageBytes(path: string): Promise<ArrayBuffer> {
  requireDesktop();
  return invoke<ArrayBuffer>("read_image_file", { path });
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

/** Native open picker. Resolves null when the user cancels. */
export async function pickScenePath(): Promise<string | null> {
  requireDesktop();
  const picked = await dialogOpen({
    multiple: false,
    directory: false,
    filters: SCENE_FILTERS,
    title: "Open scene",
  });
  return typeof picked === "string" ? picked : null;
}

/**
 * Native picker for one or more texture images. Resolves [] on cancel.
 *
 * Multi-select is on because importing a wall, a road and a roof in one go is
 * the normal case when starting a scene. Native file-drop is disabled in this
 * app (see the phase 02 notes), so this dialog is the only way in.
 */
export async function pickImagePaths(): Promise<string[]> {
  requireDesktop();
  const picked = await dialogOpen({
    multiple: true,
    directory: false,
    filters: IMAGE_FILTERS,
    title: "Import textures",
  });
  if (picked === null) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/** Native save picker. Resolves null when the user cancels. */
export async function pickSavePath(
  suggestedName: string,
): Promise<string | null> {
  requireDesktop();
  const picked = await dialogSave({
    defaultPath: withSceneExtension(suggestedName),
    filters: SCENE_FILTERS,
    title: "Save scene",
  });
  return picked ? withSceneExtension(picked) : null;
}

export async function showError(title: string, text: string): Promise<void> {
  if (!isDesktop()) {
    console.error(`[playstage] ${title}: ${text}`);
    return;
  }
  await dialogMessage(text, { title, kind: "error" });
}

export async function showInfo(title: string, text: string): Promise<void> {
  if (!isDesktop()) {
    console.info(`[playstage] ${title}: ${text}`);
    return;
  }
  await dialogMessage(text, { title, kind: "info" });
}

/** Yes/no prompt. Returns false outside the desktop shell, which is the safe
 *  answer for every question this app asks (all of them guard data loss). */
export async function confirmDiscard(text: string): Promise<boolean> {
  if (!isDesktop()) return false;
  return dialogAsk(text, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
}
