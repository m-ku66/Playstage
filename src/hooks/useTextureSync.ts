import { useEffect } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useTextureStore } from "../store/textureStore";

/**
 * Keeps the live texture cache in step with the document's texture list.
 *
 * Mounted once, at the app root, rather than inside the tray: the viewport
 * needs loaded textures whether or not the tray is expanded, and tying image
 * loading to the lifetime of a collapsible panel is the kind of coupling that
 * works until the day someone unmounts the panel.
 *
 * A hook rather than a subscription inside textureStore, so the cache stays
 * unaware of the document. The dependency runs one way: the document is the
 * truth, the cache follows it.
 *
 * This is also what makes undo free its memory. Undoing an import restores a
 * `textures` array without the asset, `sync` sees an entry whose asset is gone,
 * and the image is disposed -- instead of lingering for the session.
 */
export function useTextureSync(): void {
  const assets = useSceneStore((s) => s.textures);
  const sync = useTextureStore((s) => s.sync);

  useEffect(() => {
    sync(assets);
  }, [assets, sync]);
}
