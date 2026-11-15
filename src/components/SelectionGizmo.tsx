import { useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import type { Vec3 } from "../types/scene";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore, useSelectedIds } from "../store/editorStore";
import { useNodeStore } from "../store/nodeStore";

const DEG2RAD = Math.PI / 180;

/**
 * The transform gizmo for the current selection.
 *
 * Mounted once at the root of the scene rather than inside the object it
 * drives. That matters as soon as hierarchy exists: a gizmo mounted inside a
 * nested group would inherit that group's matrix, so a child of a 0.2-scaled
 * group would get handles a fifth of their intended size, rotated and offset
 * along with the parent. Pointing a root-level gizmo at a registered node
 * keeps the handles in world space while still writing local values.
 *
 * TransformControls mutates the target's local position/rotation/scale, and
 * those are exactly what the store holds, so the commit is a direct read-back
 * even for deeply nested objects -- Three handles the parent matrices.
 *
 * ## Single selection only, for now
 *
 * With two or more objects selected this renders nothing. Driving a multiple
 * selection needs a different mechanism entirely -- a proxy object at the
 * selection's centroid, with the proxy's delta matrix re-applied to each
 * object's world transform -- and a half-built version of that (move works,
 * rotate and scale silently do the wrong thing) would be worse than an honest
 * absence. The inspector says so on screen rather than leaving you guessing.
 */
export function SelectionGizmo() {
  const invalidate = useThree((s) => s.invalidate);

  const selectedIds = useSelectedIds();
  const transformMode = useEditorStore((s) => s.transformMode);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const translateSnap = useEditorStore((s) => s.translateSnap);
  const rotateSnapDeg = useEditorStore((s) => s.rotateSnapDeg);
  const scaleSnap = useEditorStore((s) => s.scaleSnap);
  const setDragging = useEditorStore((s) => s.setDragging);

  const soleId = selectedIds.length === 1 ? selectedIds[0] : null;

  const node = useNodeStore((s) => (soleId ? s.nodes[soleId] : null));
  const locked = useSceneStore(
    (s) => s.objects.find((o) => o.id === soleId)?.locked ?? false,
  );

  const setTransform = useSceneStore((s) => s.setTransform);
  const beginBatch = useSceneStore((s) => s.beginBatch);
  const endBatch = useSceneStore((s) => s.endBatch);

  if (!soleId || !node || locked) return null;

  /** Read the gizmo's live Object3D state back into the store. */
  const commitTransform = () => {
    setTransform(soleId, {
      position: node.position.toArray() as Vec3,
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
      scale: node.scale.toArray() as Vec3,
    });
    // frameloop is "demand", so the drag has to ask for frames itself.
    invalidate();
  };

  return (
    <TransformControls
      object={node}
      mode={transformMode}
      size={0.8}
      translationSnap={snapEnabled ? translateSnap : null}
      rotationSnap={snapEnabled ? rotateSnapDeg * DEG2RAD : null}
      scaleSnap={snapEnabled ? scaleSnap : null}
      onObjectChange={commitTransform}
      onMouseDown={() => {
        setDragging(true);
        // The whole drag collapses into one undo entry.
        beginBatch(`gizmo:${soleId}`);
      }}
      onMouseUp={() => {
        setDragging(false);
        // Commit BEFORE closing the batch -- otherwise this final write lands
        // outside it and shows up as a second undo entry.
        commitTransform();
        endBatch();
      }}
    />
  );
}
