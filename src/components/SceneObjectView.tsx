import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useShallow } from "zustand/react/shallow";
import type { FaceMaterial, SceneObject } from "../types/scene";
import { DEFAULT_MATERIAL, getGroupCount } from "../types/scene";
import { buildGeometry } from "../geometry/buildGeometry";
import { useEditorStore, useIsSelected } from "../store/editorStore";
import { useNodeStore } from "../store/nodeStore";
import { useTextureStore } from "../store/textureStore";

/** Outline on an object that is itself selected. */
const SELECTION_COLOR = "#2f6fed";
/** Softer outline on a member of a selected group, so clicking a building in
 *  the viewport shows you the whole building and not just an axis marker. */
const ANCESTOR_SELECTION_COLOR = "#a8c0f2";

/**
 * Anisotropic filtering samples, capped well below what cards report.
 *
 * Anisotropy is what keeps a tiled road or wall legible when the camera looks
 * along it at a shallow angle, which for background previz is most of the
 * time. Returns diminish sharply past 8 while bandwidth cost does not, and
 * `getMaxAnisotropy()` on a modern card reports 16, so taking the hardware
 * maximum would pay double for a difference nobody draws over.
 */
const ANISOTROPY_CAP = 8;

/**
 * Stand-in for Object3D.raycast that never reports a hit.
 *
 * Module-level so the reference is stable across renders: handing R3F a fresh
 * function every render would make it re-apply the prop every time.
 */
const IGNORE_RAYCAST = () => {};

/**
 * Overlay materials for the hovered-slot highlight.
 *
 * Module-level singletons, deliberately never disposed. The dispose-everything
 * rule exists because per-object allocations accumulate as you edit; these are
 * two materials for the lifetime of the app, shared by every highlight, and
 * freeing them would mean recreating them on the next hover.
 *
 * The highlight works by drawing the geometry a second time with an array
 * where every slot but one is invisible. Three skips a group whose material
 * has `visible: false`, so only the hovered face draws -- which costs two
 * material instances rather than the one-material-per-slot a tinted copy of
 * the real materials would need, and leaves the real materials untouched so
 * hovering never disposes and rebuilds them.
 */
const SLOT_HIDDEN_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

const SLOT_HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({
  color: SELECTION_COLOR,
  transparent: true,
  opacity: 0.3,
  // Drawn over the real face rather than fighting it for the same depth.
  // depthWrite off keeps it from occluding anything behind, and the polygon
  // offset pulls it towards the camera just enough to beat z-fighting on a
  // coplanar surface.
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  side: THREE.DoubleSide,
});

/**
 * Builds the texture instance one material slot will use.
 *
 * The clone is the point. `repeat`, `offset`, `rotation` and `center` are
 * properties of the Texture, not of the material, so two faces showing the
 * same brick at different tilings genuinely need two Texture objects -- and
 * FaceMaterial carries tiling per slot by design. `clone()` shares the master's
 * `source`, the object that owns the uploaded image, and Three ref-counts
 * WebGL textures per source: fifty clones of one brick are fifty small JS
 * objects and exactly one upload.
 *
 * `needsUpdate` is deliberately NOT set here. Its setter marks the *source*
 * dirty, which would force a re-upload of the shared image for every clone and
 * throw away the whole point of sharing it. The master already flagged the
 * upload; a clone only needs its own transform, and that reaches the shader
 * through the matrix uniform, which updates on its own.
 */
function makeSlotTexture(
  master: THREE.Texture,
  face: FaceMaterial,
  maxAnisotropy: number,
): THREE.Texture {
  const texture = master.clone();

  texture.anisotropy = Math.min(ANISOTROPY_CAP, maxAnisotropy);
  // Rotation pivots about the middle of the face rather than its corner, which
  // is what "rotate this texture 30 degrees" means to anyone placing one.
  texture.center.set(0.5, 0.5);
  texture.rotation = face.rotation;
  texture.repeat.set(face.tiling[0], face.tiling[1]);
  texture.offset.set(face.offset[0], face.offset[1]);

  return texture;
}

interface Props {
  object: SceneObject;
  /** Flat parentId -> children index, built once per objects change. */
  childrenOf: Map<string | null, SceneObject[]>;
  /**
   * The object a viewport click anywhere in this subtree selects.
   *
   * Always the outermost ancestor, so clicking a wall of a grouped building
   * selects the building. Group members stay reachable through the outliner,
   * where picking one is deliberate rather than accidental.
   */
  pickRootId: string;
  /** True when the pick root is locked, so the whole subtree is invisible to
   *  the raycaster and clicks fall through to whatever is behind it. */
  pickBlocked: boolean;
  /** True when something above this object is selected. */
  ancestorSelected: boolean;
}

/**
 * Renders a single SceneObject and, recursively, everything parented to it.
 *
 * Nesting is what makes grouping work: a child's <group> sits inside its
 * parent's, so the parent's matrix cascades down for free. Hiding a parent
 * returns null and takes the whole subtree with it, which is the expected
 * behaviour.
 *
 * Geometry and materials are memoised on the parts of the object that affect
 * them, and disposed when they change. Transform changes do NOT rebuild
 * geometry -- they only update the group's matrix, which is what keeps
 * dragging cheap.
 */
export function SceneObjectView({
  object,
  childrenOf,
  pickRootId,
  pickBlocked,
  ancestorSelected,
}: Props) {
  const register = useNodeStore((s) => s.register);
  const unregister = useNodeStore((s) => s.unregister);
  const gl = useThree((s) => s.gl);

  const isSelected = useIsSelected(object.id);
  const isGroup = object.geometry.kind === "group";
  const children = childrenOf.get(object.id);

  // Callback ref rather than useRef: the node has to reach the node store so
  // the root-level gizmo can attach to it, and a plain ref would not trigger
  // the render that publishes it.
  const [node, setNode] = useState<THREE.Group | null>(null);

  useEffect(() => {
    if (!node) return;
    register(object.id, node);
    return () => unregister(object.id);
  }, [node, object.id, register, unregister]);

  // A group is a transform container with no mesh of its own, so it skips
  // geometry entirely. Hooks still run -- they just produce nothing.
  const geometry = useMemo(
    () => (isGroup ? null : buildGeometry(object.geometry)),
    [object.geometry, isGroup],
  );

  // Depends on the material SLOT COUNT, not the whole geometry spec. A slot
  // count only changes when the primitive kind does, so editing a radius
  // rebuilds the geometry without needlessly disposing and recreating every
  // material alongside it.
  const groupCount = isGroup ? 0 : getGroupCount(object.geometry);

  /**
   * Master textures for this object's slots, one entry per slot, null where the
   * slot has no texture or its image has not decoded yet.
   *
   * Subscribed through useShallow and narrowed to the ids THIS object uses,
   * rather than reading the whole cache. Reading the cache wholesale would
   * re-render and rebuild materials for every object in the scene each time any
   * texture finished loading -- a hundred-object scene would dispose and
   * recreate several hundred materials per imported file.
   */
  const masters = useTextureStore(
    useShallow((s) => {
      const out: (THREE.Texture | null)[] = [];
      for (let i = 0; i < groupCount; i++) {
        const id = object.materials[i]?.textureId ?? null;
        out.push(id ? (s.entries[id]?.texture ?? null) : null);
      }
      return out;
    }),
  );

  /** The hovered slot index, but only while the hover belongs to THIS object. */
  const highlightedSlot = useEditorStore((s) =>
    s.highlightedSlot?.objectId === object.id ? s.highlightedSlot.slot : null,
  );

  const highlightMaterials = useMemo(() => {
    if (highlightedSlot === null || groupCount === 0) return null;
    if (highlightedSlot >= groupCount) return null;

    return Array.from({ length: groupCount }, (_, i) =>
      i === highlightedSlot ? SLOT_HIGHLIGHT_MATERIAL : SLOT_HIDDEN_MATERIAL,
    );
  }, [highlightedSlot, groupCount]);

  const materials = useMemo(() => {
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
    const list: THREE.Material[] = [];

    for (let i = 0; i < groupCount; i++) {
      const face = object.materials[i] ?? DEFAULT_MATERIAL;
      const master = masters[i];

      list.push(
        new THREE.MeshStandardMaterial({
          map: master ? makeSlotTexture(master, face, maxAnisotropy) : null,
          // Multiplies the texture when there is one, so the colour doubles as
          // a tint. White leaves a texture untouched, which is why an object
          // that gets a texture keeps whatever colour it already had.
          color: new THREE.Color(face.color),
          roughness: 0.9,
          metalness: 0,
          side: face.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        }),
      );
    }

    return list;
  }, [groupCount, object.materials, masters, gl]);

  // Dispose GPU resources when replaced or unmounted. Without this, editing a
  // primitive repeatedly leaks.
  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Material.dispose() does NOT touch the textures a material references, so
  // the slot clones have to be released by hand. Disposing a clone decrements
  // the shared source's ref count; the uploaded image itself only goes when
  // the last clone of it does, which is exactly the wanted behaviour.
  useEffect(
    () => () =>
      materials.forEach((material) => {
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      }),
    [materials],
  );

  if (!object.visible) return null;

  /**
   * Note that `object.locked` is not consulted here.
   *
   * A click in the viewport resolves to `pickRootId` regardless of which mesh
   * was hit, so a member's own lock cannot affect viewport picking -- the
   * member was never the candidate. Only the pick root's lock matters, and
   * that arrives as `pickBlocked`. A member's lock still blocks selecting it
   * from the outliner, which is the only place it can be selected at all.
   */
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (pickBlocked) return;
    e.stopPropagation();

    const editor = useEditorStore.getState();
    if (e.nativeEvent.shiftKey) editor.toggleSelected(pickRootId);
    else editor.select(pickRootId);
  };

  const showOutline = isSelected || ancestorSelected;

  return (
    <group
      ref={setNode}
      position={object.transform.position}
      rotation={object.transform.rotation}
      scale={object.transform.scale}
    >
      {geometry && (
        <>
          <mesh
            geometry={geometry}
            material={materials.length === 1 ? materials[0] : materials}
            onClick={handleClick}
            // Swapped on the mesh itself rather than guarded in the handler.
            // A handler that merely returns still counts as a hit, which stops
            // onPointerMissed from firing and swallows the click; removing the
            // mesh from the raycast instead lets it pass through to whatever
            // is behind, and lets a click on empty space still deselect.
            raycast={pickBlocked ? IGNORE_RAYCAST : THREE.Mesh.prototype.raycast}
            castShadow
            receiveShadow
          />
          {highlightMaterials && (
            <mesh
              geometry={geometry}
              // Same single-vs-array rule as the real mesh: a geometry with no
              // groups (a sphere, a plane) ignores a material array and would
              // draw nothing at all.
              material={
                highlightMaterials.length === 1
                  ? highlightMaterials[0]
                  : highlightMaterials
              }
              raycast={IGNORE_RAYCAST}
              renderOrder={2}
            />
          )}

          {showOutline && (
            <lineSegments>
              <edgesGeometry args={[geometry]} />
              <lineBasicMaterial
                color={isSelected ? SELECTION_COLOR : ANCESTOR_SELECTION_COLOR}
              />
            </lineSegments>
          )}
        </>
      )}

      {/* A selected empty group has nothing to outline, so mark its origin. */}
      {isGroup && isSelected && <axesHelper args={[0.6]} renderOrder={1} />}

      {children?.map((child) => (
        <SceneObjectView
          key={child.id}
          object={child}
          childrenOf={childrenOf}
          pickRootId={pickRootId}
          pickBlocked={pickBlocked}
          ancestorSelected={showOutline}
        />
      ))}
    </group>
  );
}
