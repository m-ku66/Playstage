import { create } from "zustand";
import * as THREE from "three";
import type { TextureAsset } from "../types/scene";
import { imageMimeType, readImageBytes } from "../io/nativeFs";

/**
 * Decoded texture images, keyed by texture asset id.
 *
 * Lives outside sceneStore for the same reason nodeStore does: these are live
 * GPU-backed objects, never saved and never snapshotted by undo. The document
 * holds only the id, name and path (see TextureAsset).
 *
 * ## One master, many clones
 *
 * Each entry holds a single "master" THREE.Texture. Material slots never use
 * the master directly -- they use `master.clone()`.
 *
 * This is not an optimisation detail, it is forced by where Three keeps the UV
 * transform. `repeat`, `offset`, `rotation` and `center` are properties of the
 * *Texture*, not of the material. Two faces showing the same brick at
 * different tilings therefore need two Texture objects, and FaceMaterial
 * carries per-slot tiling by design.
 *
 * Clones are nearly free, because `clone()` shares the `source` -- the object
 * that actually owns the uploaded image. Three ref-counts WebGL textures per
 * source, so fifty clones of one brick are fifty tiny JS objects and exactly
 * one upload to the GPU. Without the shared source this would be fifty
 * uploads, which is how a texture system eats a graphics card.
 *
 * Disposal splits along the same line: whoever makes a clone disposes it
 * (SceneObjectView's cleanup effect), and the master is disposed only when the
 * asset leaves the document. Because of the source ref count, disposing the
 * master while clones are still mounted does not pull the image out from
 * under them.
 */

export type TextureStatus = "loading" | "ready" | "missing";

export interface TextureEntry {
  status: TextureStatus;
  /** Null until the image has decoded, and when it failed to. */
  texture: THREE.Texture | null;
  /** Human-readable reason, shown in the tray. Null unless status is missing. */
  error: string | null;
  /** Pixel dimensions, for the tray readout. */
  width: number;
  height: number;
  /**
   * Small data URL for the tray tile. Null when the canvas refused it.
   *
   * A separate downscaled copy rather than drawing the decoded element
   * directly: an HTMLImageElement is a single live DOM node and cannot be
   * mounted in two tiles, and re-deriving one per tile per render would be
   * worse than carrying a few kilobytes of PNG here. It lives in this store
   * rather than the document for the same reason the texture does -- it is
   * derived, disposable, and has no business being written to a scene file.
   */
  thumbnail: string | null;
  /** The path this entry was decoded from. A changed path forces a reload. */
  path: string;
}

interface TextureState {
  entries: Record<string, TextureEntry>;

  /**
   * Makes sure an asset's image is loaded, or loading.
   *
   * Idempotent and safe to call from render: it returns without touching state
   * when the entry already matches the asset's path, so it will not loop.
   */
  ensure: (asset: TextureAsset) => void;

  /**
   * Brings the cache into line with the document's texture list.
   *
   * Starts loads for assets with no entry, and disposes entries whose asset is
   * gone -- which is what makes undoing a texture import actually free the
   * image rather than leaking it for the rest of the session.
   */
  sync: (assets: readonly TextureAsset[]) => void;

  /** Retries a missing texture, for the tray's reload button. */
  reload: (asset: TextureAsset) => void;

  /** Drops and disposes everything. Used when a new scene is opened. */
  clear: () => void;
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

/**
 * Bytes -> HTMLImageElement, via a short-lived object URL.
 *
 * An HTMLImageElement rather than createImageBitmap: bitmaps decode off the
 * main thread, but the `imageOrientation` option needed to get their vertical
 * flip to agree with Three's default is unevenly supported across the webviews
 * Tauri sits on (WebView2, WKWebView, WebKitGTK). Texture import is a handful
 * of user-initiated loads, not a per-frame cost, so correctness everywhere
 * beats shaving milliseconds off an action that happens twice a scene.
 *
 * The object URL is revoked as soon as the element has loaded. The element
 * keeps its own decoded copy, so revoking does not invalidate the texture.
 */
async function decodeImage(path: string): Promise<HTMLImageElement> {
  const bytes = await readImageBytes(path);
  const blob = new Blob([bytes], { type: imageMimeType(path) });
  const url = URL.createObjectURL(blob);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error("the file could not be decoded as an image"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Longest edge of a tray thumbnail, in CSS pixels before DPR. */
const THUMBNAIL_PX = 96;

/**
 * Downscales a decoded image to a tray-sized data URL.
 *
 * Aspect ratio is preserved rather than squared off, because a texture's
 * proportions are information: a 4:1 strip of siding and a square brick tile
 * behave very differently once tiled, and the tile is where you notice.
 *
 * Returns null rather than throwing on failure. A thumbnail is a convenience;
 * losing one must not stop the texture itself from loading.
 */
function makeThumbnail(image: HTMLImageElement): string | null {
  try {
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (longest === 0) return null;

    const scale = Math.min(1, THUMBNAIL_PX / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) return null;

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Wraps a decoded image in the master texture.
 *
 * Settings worth naming:
 *  - sRGB colour space. Without it every texture renders noticeably washed
 *    out, because Three would treat the file's gamma-encoded values as linear.
 *  - Repeat wrapping, so a FaceMaterial tiling above 1 actually repeats
 *    instead of smearing the edge pixel across the face.
 *  - Mipmaps with trilinear minification, so a tiled wall seen at a shallow
 *    angle shimmers instead of aliasing into noise. WebGL2 supports both on
 *    non-power-of-two images, so arbitrary texture sizes are fine.
 *
 * Anisotropy is NOT set here. Its useful maximum is a property of the renderer
 * (`gl.capabilities.getMaxAnisotropy()`), which this store has no access to by
 * design, so it is applied to each clone in the viewport instead.
 */
function makeTexture(image: HTMLImageElement): THREE.Texture {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Turns whatever a failed load threw into one line a user can act on. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "could not be loaded";
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export const useTextureStore = create<TextureState>((set, get) => {
  /**
   * Loads one asset and writes the result into its entry.
   *
   * The id-and-path recheck before each write is what makes concurrent and
   * superseded loads safe: by the time a slow 8 MB decode finishes, the asset
   * may have been deleted or pointed at a different file, and the stale result
   * must not overwrite the newer one.
   */
  async function load(asset: TextureAsset) {
    const { id, path } = asset;

    // Caught here rather than in Rust. The scene parser defaults a missing
    // path to "", and handing that to read_image_file would come back as
    // "not an image Playstage can read", which points at the wrong problem.
    if (path === "") {
      set((s) => ({
        entries: {
          ...s.entries,
          [id]: {
            status: "missing",
            texture: null,
            error: "no file path is recorded for this texture",
            width: 0,
            height: 0,
            thumbnail: null,
            path,
          },
        },
      }));
      return;
    }

    set((s) => ({
      entries: {
        ...s.entries,
        [id]: {
          status: "loading",
          texture: null,
          error: null,
          width: 0,
          height: 0,
          thumbnail: null,
          path,
        },
      },
    }));

    try {
      const image = await decodeImage(path);

      if (get().entries[id]?.path !== path) {
        // Superseded while decoding. Nothing was uploaded to the GPU yet, so
        // dropping the image is all the cleanup there is.
        return;
      }

      const texture = makeTexture(image);
      set((s) => ({
        entries: {
          ...s.entries,
          [id]: {
            status: "ready",
            texture,
            error: null,
            width: image.naturalWidth,
            height: image.naturalHeight,
            thumbnail: makeThumbnail(image),
            path,
          },
        },
      }));
    } catch (error) {
      if (get().entries[id]?.path !== path) return;
      set((s) => ({
        entries: {
          ...s.entries,
          [id]: {
            status: "missing",
            texture: null,
            error: describeFailure(error),
            width: 0,
            height: 0,
            thumbnail: null,
            path,
          },
        },
      }));
    }
  }

  return {
    entries: {},

    ensure: (asset) => {
      const existing = get().entries[asset.id];
      if (existing && existing.path === asset.path) return;
      void load(asset);
    },

    sync: (assets) => {
      const alive = new Set(assets.map((a) => a.id));
      const entries = get().entries;

      const stale = Object.keys(entries).filter((id) => !alive.has(id));
      if (stale.length > 0) {
        const next = { ...entries };
        for (const id of stale) {
          next[id].texture?.dispose();
          delete next[id];
        }
        set({ entries: next });
      }

      for (const asset of assets) get().ensure(asset);
    },

    reload: (asset) => {
      const existing = get().entries[asset.id];
      existing?.texture?.dispose();
      void load(asset);
    },

    clear: () => {
      for (const entry of Object.values(get().entries)) {
        entry.texture?.dispose();
      }
      set({ entries: {} });
    },
  };
});

/* ------------------------------------------------------------------ */
/* Selectors                                                          */
/* ------------------------------------------------------------------ */

/** The master texture for an id, or null while loading / when missing. */
export const useMasterTexture = (
  textureId: string | null,
): THREE.Texture | null =>
  useTextureStore((s) =>
    textureId ? (s.entries[textureId]?.texture ?? null) : null,
  );

export const useTextureEntry = (id: string): TextureEntry | undefined =>
  useTextureStore((s) => s.entries[id]);
