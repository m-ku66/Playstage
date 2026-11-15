import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { SceneObject } from "../types/scene";
import { DEFAULT_MATERIAL } from "../types/scene";
import { buildGeometry, getGroupCount } from "../geometry/buildGeometry";
import { useEditorStore, useIsSelected } from "../store/editorStore";
import { useNodeStore } from "../store/nodeStore";

/** Outline on an object that is itself selected. */
const SELECTION_COLOR = "#2f6fed";
/** Softer outline on a member of a selected group, so clicking a building in
 *  the viewport shows you the whole building and not just an axis marker. */
const ANCESTOR_SELECTION_COLOR = "#a8c0f2";

/**
 * Stand-in for Object3D.raycast that never reports a hit.
 *
 * Module-level so the reference is stable across renders: handing R3F a fresh
 * function every render would make it re-apply the prop every time.
 */
const IGNORE_RAYCAST = () => {};

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

  const materials = useMemo(() => {
    const list: THREE.Material[] = [];
    for (let i = 0; i < groupCount; i++) {
      const face = object.materials[i] ?? DEFAULT_MATERIAL;
      list.push(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(face.color),
          roughness: 0.9,
          metalness: 0,
          side: face.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        }),
      );
    }
    return list;
  }, [groupCount, object.materials]);

  // Dispose GPU resources when replaced or unmounted. Without this, editing a
  // primitive repeatedly leaks.
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

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
