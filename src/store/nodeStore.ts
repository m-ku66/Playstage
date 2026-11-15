import { create } from "zustand";
import type { Object3D } from "three";

/**
 * Live Three.js nodes, keyed by scene object id.
 *
 * Needed because the transform gizmo is rendered at the root of the scene,
 * not inside the object it manipulates. If TransformControls were mounted
 * inside a nested group, the parent's matrix would be applied to the gizmo
 * helper too -- a child of a 0.2-scaled group would get handles a fifth of
 * their intended size. Mounting the gizmo at the root and pointing it at a
 * registered node keeps the handles in world space where they belong.
 *
 * These are live mutable Three objects, deliberately kept out of sceneStore:
 * they are not part of the document, never saved, and never snapshotted.
 */

interface NodeState {
  nodes: Record<string, Object3D>;
  register: (id: string, node: Object3D) => void;
  unregister: (id: string) => void;
}

export const useNodeStore = create<NodeState>((set) => ({
  nodes: {},

  register: (id, node) =>
    set((s) => ({ nodes: { ...s.nodes, [id]: node } })),

  unregister: (id) =>
    set((s) => {
      if (!(id in s.nodes)) return s;
      const next = { ...s.nodes };
      delete next[id];
      return { nodes: next };
    }),
}));
