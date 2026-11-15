import type { GeometrySpec, Vec3 } from "../types/scene";

/**
 * Measuring geometry, as opposed to building it.
 *
 * Deliberately a separate module from buildGeometry.ts. Beyond the obvious
 * separation of concerns, verify-params.mjs checks the builder by scanning its
 * source for every `p.<param>` it reads, case by case -- so a second switch
 * over the same primitive names sitting in that file makes the harness measure
 * the wrong function. Keeping measurement out of the builder's file keeps that
 * check meaningful. (The harness is now bounded to buildPrimitive too, but one
 * belt and one set of braces is the right number.)
 */

/**
 * Local-space bounding size of a geometry spec, before any transform.
 *
 * Derived from the parameters rather than by building the geometry and reading
 * its bounding box: the inspector wants this on every render, and allocating a
 * BufferGeometry just to measure it and throw it away would be wasteful. It
 * also keeps this a pure function, testable without a WebGL context.
 *
 * Returns null for anything with no mesh of its own.
 */
export function geometrySize(spec: GeometrySpec): Vec3 | null {
  if (spec.kind !== "primitive") return null;

  const params = spec.params;
  switch (spec.primitive) {
    case "box":
      return [params.width, params.height, params.depth];

    case "sphere": {
      const diameter = params.radius * 2;
      return [diameter, diameter, diameter];
    }

    case "cylinder": {
      // The wider of the two ends is what the footprint has to clear.
      const diameter = Math.max(params.radiusTop, params.radiusBottom) * 2;
      return [diameter, params.height, diameter];
    }

    case "cone": {
      const diameter = params.radius * 2;
      return [diameter, params.height, diameter];
    }

    case "plane":
      // Flat in Z. Reported as zero rather than omitted, so a plane used as a
      // backdrop still shows its real width and height.
      return [params.width, params.height, 0];

    default: {
      const never: never = spec.primitive;
      throw new Error(`[playstage] unknown primitive: ${never}`);
    }
  }
}
