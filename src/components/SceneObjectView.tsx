import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { SceneObject } from "../types/scene";
import { DEFAULT_MATERIAL } from "../types/scene";
import { buildGeometry, getGroupCount } from "../geometry/buildGeometry";
import { useEditorStore } from "../store/editorStore";
import { useNodeStore } from "../store/nodeStore";

const SELECTION_COLOR = "#2f6fed";

interface Props {
  object: SceneObject;
  /** Flat parentId -> children index, built once per objects change. */
  childrenOf: Map<string | null, SceneObject[]>;
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
export function SceneObjectView({ object, childrenOf }: Props) {
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const register = useNodeStore((s) => s.register);
  const unregister = useNodeStore((s) => s.unregister);

  const isSelected = selectedId === object.id;
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

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (object.locked) return;
    e.stopPropagation();
    select(object.id);
  };

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
            castShadow
            receiveShadow
          />
          {isSelected && (
            <lineSegments>
              <edgesGeometry args={[geometry]} />
              <lineBasicMaterial color={SELECTION_COLOR} />
            </lineSegments>
          )}
        </>
      )}

      {/* A selected empty group has nothing to outline, so mark its origin. */}
      {isGroup && isSelected && (
        <axesHelper args={[0.6]} renderOrder={1} />
      )}

      {children?.map((child) => (
        <SceneObjectView key={child.id} object={child} childrenOf={childrenOf} />
      ))}
    </group>
  );
}
