import { useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import type { Vec3 } from "../types/scene";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useNodeStore } from "../store/nodeStore";

const DEG2RAD = Math.PI / 180;

/**
 * The transform gizmo for whatever is currently selected.
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
 */
export function SelectionGizmo() {
  const invalidate = useThree((s) => s.invalidate);

  const selectedId = useEditorStore((s) => s.selectedId);
  const transformMode = useEditorStore((s) => s.transformMode);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const translateSnap = useEditorStore((s) => s.translateSnap);
  const rotateSnapDeg = useEditorStore((s) => s.rotateSnapDeg);
  const scaleSnap = useEditorStore((s) => s.scaleSnap);
  const setDragging = useEditorStore((s) => s.setDragging);

  const node = useNodeStore((s) => (selectedId ? s.nodes[selectedId] : null));
  const locked = useSceneStore(
    (s) => s.objects.find((o) => o.id === selectedId)?.locked ?? false,
  );

  const setTransform = useSceneStore((s) => s.setTransform);
  const beginBatch = useSceneStore((s) => s.beginBatch);
  const endBatch = useSceneStore((s) => s.endBatch);

  if (!selectedId || !node || locked) return null;

  /** Read the gizmo's live Object3D state back into the store. */
  const commitTransform = () => {
    setTransform(selectedId, {
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
        beginBatch(`gizmo:${selectedId}`);
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
