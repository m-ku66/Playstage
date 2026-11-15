import * as THREE from "three";
import type { GeometrySpec, PrimitiveKind } from "../types/scene";
import { PRIMITIVE_GROUP_COUNT } from "../types/scene";

/**
 * Turns a GeometrySpec into a BufferGeometry.
 *
 * Every branch returns a freshly allocated geometry, so the caller owns it and
 * is responsible for calling .dispose() when the spec changes. Viewport.tsx
 * does this via useMemo + a cleanup effect.
 *
 * Only `primitive` is implemented in this chunk. The other branches throw a
 * clearly-labelled error rather than silently returning a placeholder, so an
 * unimplemented path is loud during development instead of mysterious.
 */
export function buildGeometry(spec: GeometrySpec): THREE.BufferGeometry {
  switch (spec.kind) {
    case "primitive":
      return buildPrimitive(spec.primitive, spec.params);

    case "extrude":
      throw new Error("[playstage] extrude geometry not implemented yet");

    case "lathe":
      throw new Error("[playstage] lathe geometry not implemented yet");

    case "csg":
      throw new Error("[playstage] csg geometry not implemented yet");

    case "group":
      throw new Error("[playstage] groups have no geometry of their own");

    default: {
      // Exhaustiveness check: if a new GeometrySpec variant is added and not
      // handled above, this line stops compiling.
      const never: never = spec;
      throw new Error(`[playstage] unhandled geometry spec: ${never}`);
    }
  }
}

function buildPrimitive(
  kind: PrimitiveKind,
  p: Record<string, number>,
): THREE.BufferGeometry {
  switch (kind) {
    case "box":
      return new THREE.BoxGeometry(p.width, p.height, p.depth);

    case "sphere":
      return new THREE.SphereGeometry(
        p.radius,
        p.widthSegments,
        p.heightSegments,
      );

    case "cylinder":
      return new THREE.CylinderGeometry(
        p.radiusTop,
        p.radiusBottom,
        p.height,
        p.radialSegments,
      );

    case "cone":
      return new THREE.ConeGeometry(p.radius, p.height, p.radialSegments);

    case "plane":
      return new THREE.PlaneGeometry(p.width, p.height);

    default: {
      const never: never = kind;
      throw new Error(`[playstage] unknown primitive: ${never}`);
    }
  }
}

/**
 * How many separately texturable material slots this geometry exposes.
 *
 * For primitives this is a lookup table. For generated geometry (extrude,
 * lathe, csg) we will read it off geometry.groups instead, which is why this
 * takes the spec rather than being a constant on the caller's side.
 */
export function getGroupCount(spec: GeometrySpec): number {
  if (spec.kind === "primitive") return PRIMITIVE_GROUP_COUNT[spec.primitive];
  if (spec.kind === "group") return 0;
  // Generated geometry: caller will pass the real group count once those
  // branches exist. One slot is the safe default until then.
  return 1;
}
