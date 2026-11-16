import { useMemo } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore, useSelectedIds } from "../store/editorStore";
import { useTextureStore, type TextureEntry } from "../store/textureStore";
import {
  NotDesktopError,
  filename,
  basename,
  pickImagePaths,
  showError,
} from "../io/nativeFs";
import type { TextureAsset } from "../types/scene";

/**
 * The texture tray: a horizontal strip of imported images under the viewport.
 *
 * Horizontal rather than a panel column because a texture is recognised by its
 * picture, and a row of pictures scans faster than a list of names. It sits
 * under the viewport instead of in a side panel so the thumbnails can be big
 * enough to tell brick from cobblestone at a glance, which is the whole job of
 * the thing. That costs viewport height, which is why it collapses.
 *
 * Clicking a tile applies it to the current selection immediately. There is no
 * "assign" button and no mode to enter: the texture IS the verb. Per-face
 * control, which needs a target more precise than "the selection", arrives
 * with the slot controls in the inspector.
 */

/** Height of the thumbnail row. Tuned so a 1:1 tile reads clearly without
 *  taking a bite out of the viewport you would notice while orbiting. */
const TILE_PX = 64;

function TrayButton({
  label,
  title,
  onClick,
  disabled,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md border border-stage-line bg-stage-field px-2 py-1 text-[11px] text-stage-muted transition-colors hover:border-stage-accent hover:text-stage-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-stage-line disabled:hover:text-stage-muted"
    >
      {label}
    </button>
  );
}

/** One thumbnail. Also the status indicator for its load. */
function TextureTile({
  asset,
  entry,
  active,
  applies,
  onApply,
  onFocus,
}: {
  asset: TextureAsset;
  entry: TextureEntry | undefined;
  active: boolean;
  /** False when the selection is empty, so clicking cannot apply anything.
   *  The tile stays clickable -- highlighting it is still useful, and it is
   *  how you reach rename and remove -- but it says so rather than looking
   *  like it worked. */
  applies: boolean;
  onApply: () => void;
  onFocus: () => void;
}) {
  const status = entry?.status ?? "loading";

  // The path is in the tooltip rather than on the tile. It is the thing you
  // need when a texture goes missing and clutter the rest of the time.
  const tooltip =
    status === "missing"
      ? `${filename(asset.path)} — ${entry?.error ?? "could not be loaded"}`
      : [
          asset.name,
          asset.path,
          entry?.width ? `${entry.width} × ${entry.height}` : "",
          applies ? "" : "Select an object first to apply this.",
        ]
          .filter(Boolean)
          .join("\n");

  return (
    <button
      onClick={() => {
        onFocus();
        if (status === "ready") onApply();
      }}
      title={tooltip}
      style={{ width: TILE_PX }}
      className={`group shrink-0 rounded-md border p-1 text-left transition-colors ${
        active
          ? "border-stage-accent bg-stage-accent-soft"
          : "border-stage-line bg-stage-panel hover:border-stage-line-strong"
      }`}
    >
      <div
        style={{ height: TILE_PX - 8 }}
        className="mb-1 flex items-center justify-center overflow-hidden rounded bg-stage-field"
      >
        {entry?.thumbnail ? (
          <img
            src={entry.thumbnail}
            alt=""
            draggable={false}
            className={`h-full w-full object-cover transition-opacity ${
              applies ? "" : "opacity-45"
            }`}
          />
        ) : (
          <span
            className={`text-[9px] uppercase tracking-[0.1em] ${
              status === "missing" ? "text-stage-warn" : "text-stage-faint"
            }`}
          >
            {status === "missing" ? "lost" : "···"}
          </span>
        )}
      </div>
      <div className="truncate text-[10px] leading-tight text-stage-muted">
        {asset.name}
      </div>
    </button>
  );
}

/** Rename / remove / retry for whichever tile is highlighted. */
function ActiveTextureControls({ asset }: { asset: TextureAsset }) {
  const renameTexture = useSceneStore((s) => s.renameTexture);
  const removeTexture = useSceneStore((s) => s.removeTexture);
  const setMaterialMany = useSceneStore((s) => s.setMaterialMany);
  const reload = useTextureStore((s) => s.reload);
  const entry = useTextureStore((s) => s.entries[asset.id]);
  const selectedIds = useSelectedIds();

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-l border-stage-line pl-3">
      <input
        value={asset.name}
        onChange={(e) => renameTexture(asset.id, e.target.value)}
        className="w-28 rounded-md border border-stage-line bg-stage-field px-2 py-1 text-[11px] text-stage-ink outline-none transition-colors focus:border-stage-accent focus:bg-stage-panel"
      />

      {entry?.status === "missing" && (
        <TrayButton
          label="Retry"
          title={entry.error ?? undefined}
          onClick={() => reload(asset)}
        />
      )}

      {/* Clearing is separate from removing: wanting a face back to flat
          colour is a different intention from wanting the asset gone. */}
      <TrayButton
        label="Clear"
        title="Remove this texture from the selected objects, keeping the asset"
        disabled={selectedIds.length === 0}
        onClick={() => setMaterialMany(selectedIds, { textureId: null })}
      />
      <TrayButton
        label="Remove"
        title="Delete the asset and clear it from every object using it"
        onClick={() => removeTexture(asset.id)}
      />
    </div>
  );
}

export function TextureTray() {
  const textures = useSceneStore((s) => s.textures);
  const addTextures = useSceneStore((s) => s.addTextures);
  const setMaterialMany = useSceneStore((s) => s.setMaterialMany);

  const open = useEditorStore((s) => s.textureTrayOpen);
  const toggleOpen = useEditorStore((s) => s.toggleTextureTray);
  const activeTextureId = useEditorStore((s) => s.activeTextureId);
  const setActiveTexture = useEditorStore((s) => s.setActiveTexture);
  const selectedIds = useSelectedIds();

  const entries = useTextureStore((s) => s.entries);

  const active = useMemo(
    () => textures.find((t) => t.id === activeTextureId) ?? null,
    [textures, activeTextureId],
  );

  // Counted off the document's asset list rather than the whole cache, so a
  // texture removed while its entry is still being torn down is not reported
  // as missing on the way out.
  const missingCount = useMemo(
    () =>
      textures.filter((t) => entries[t.id]?.status === "missing").length,
    [textures, entries],
  );

  async function handleImport() {
    try {
      const paths = await pickImagePaths();
      if (paths.length === 0) return;

      const ids = addTextures(
        paths.map((path) => ({ name: basename(path), path })),
      );
      // Highlight the last one brought in, so the controls point at something
      // immediately after an import rather than staying empty.
      setActiveTexture(ids[ids.length - 1] ?? null);
    } catch (error) {
      if (error instanceof NotDesktopError) {
        await showError("Import textures", error.message);
        return;
      }
      await showError(
        "Import textures",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return (
    <section className="shrink-0 border-t border-stage-line bg-stage-panel">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={toggleOpen}
          title={open ? "Collapse the tray" : "Expand the tray"}
          className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stage-faint transition-colors hover:text-stage-ink"
        >
          <span className="font-mono text-[9px]">{open ? "▾" : "▸"}</span>
          Textures
          {textures.length > 0 && (
            <span className="font-mono text-[10px] tracking-normal text-stage-faint">
              {textures.length}
            </span>
          )}
        </button>

        {open && missingCount > 0 && (
          <span
            title="These files could not be read from disk. Use Retry after putting them back, or re-import them."
            className="rounded border border-stage-warn/40 bg-stage-warn/10 px-1.5 py-0.5 text-[10px] text-stage-warn"
          >
            {missingCount} missing
          </span>
        )}

        <div className="flex-1" />

        {/* Says where a click lands. Without it, clicking a tile with nothing
            selected is a silent no-op, which reads as the feature being
            broken rather than as a missing selection. */}
        {open && textures.length > 0 && (
          <span className="text-[10px] text-stage-faint">
            {selectedIds.length === 0
              ? "select an object to apply"
              : `applies to ${selectedIds.length} selected`}
          </span>
        )}

        {open && active && <ActiveTextureControls asset={active} />}

        {open && (
          <TrayButton label="Import…" onClick={() => void handleImport()} />
        )}
      </div>

      {open && (
        <div className="flex items-start gap-2 overflow-x-auto px-3 pb-3">
          {textures.length === 0 ? (
            <p className="py-3 text-[12px] leading-relaxed text-stage-faint">
              No textures yet. Import a few images, then click one to apply it
              to whatever is selected.
            </p>
          ) : (
            textures.map((asset) => (
              <TextureTile
                key={asset.id}
                asset={asset}
                entry={entries[asset.id]}
                active={asset.id === activeTextureId}
                applies={selectedIds.length > 0}
                onFocus={() => setActiveTexture(asset.id)}
                onApply={() =>
                  setMaterialMany(selectedIds, { textureId: asset.id })
                }
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
