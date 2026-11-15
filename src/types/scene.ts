/**
 * Playstage scene data model.
 *
 * Design note: `GeometrySpec` is a discriminated union so the renderer can grow
 * from plain primitives -> extrude/lathe profiles -> CSG booleans without the
 * scene format or the store having to change shape later. Only `primitive` and
 * `group` are implemented right now; the other variants are declared so the
 * file format and reducers are already built around them.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export type PrimitiveKind = "box" | "sphere" | "cylinder" | "cone" | "plane";

/** Parameter bag per primitive. Kept loose on purpose so the inspector UI can
 *  render numeric fields generically from PRIMITIVE_PARAMS. */
export type PrimitiveParams = Record<string, number>;

export type BooleanOp = "union" | "subtract" | "intersect";

export type GeometrySpec =
  /** A built-in Three.js primitive. */
  | { kind: "primitive"; primitive: PrimitiveKind; params: PrimitiveParams }
  /** A 2D profile pushed along Z. This is how custom arches/ramps get made. */
  | {
      kind: "extrude";
      profile: Vec2[];
      depth: number;
      bevelEnabled: boolean;
      bevelSize: number;
      bevelThickness: number;
      bevelSegments: number;
      /** Optional inner holes, each a closed loop of points. */
      holes: Vec2[][];
    }
  /** A 2D profile revolved around the Y axis. */
  | { kind: "lathe"; profile: Vec2[]; segments: number; phiLength: number }
  /** Boolean of two other objects in the scene, referenced by id. */
  | { kind: "csg"; op: BooleanOp; aId: string; bId: string }
  /** Transform-only container. Has no mesh of its own. */
  | { kind: "group" };

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

/** One slot of a mesh's material group list. A BoxGeometry has 6 of these,
 *  a CylinderGeometry 3, a SphereGeometry 1, and so on. */
export interface FaceMaterial {
  /** Reference into SceneFile.textures. null = flat colour only. */
  textureId: string | null;
  /** Base colour, hex string. Multiplies the texture when one is set. */
  color: string;
  /** UV repeat. */
  tiling: Vec2;
  /** UV offset. */
  offset: Vec2;
  /** UV rotation in radians. */
  rotation: number;
  /** Render both sides of the face. Useful for planes used as flats. */
  doubleSided: boolean;
}

export interface TextureAsset {
  id: string;
  name: string;
  /** Path on disk, resolved at load time. Empty while the asset is unsaved. */
  path: string;
  /** Data URL kept in memory for the live session. */
  dataUrl: string | null;
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

export interface Transform {
  position: Vec3;
  /** Euler XYZ in radians. */
  rotation: Vec3;
  scale: Vec3;
}

export interface SceneObject {
  id: string;
  name: string;
  /** Parent object id, or null for a root-level object. */
  parentId: string | null;
  transform: Transform;
  geometry: GeometrySpec;
  /** Keyed by material group index. Missing keys fall back to DEFAULT_MATERIAL. */
  materials: Record<number, FaceMaterial>;
  visible: boolean;
  /** Excluded from picking in the viewport. */
  locked: boolean;
}

/* ------------------------------------------------------------------ */
/* Camera hotspots                                                     */
/* ------------------------------------------------------------------ */

export interface CameraHotspot {
  id: string;
  name: string;
  position: Vec3;
  /** Point the camera looks at. Stored instead of a quaternion so the value
   *  stays readable and editable in the inspector. */
  target: Vec3;
  fov: number;
}

/* ------------------------------------------------------------------ */
/* File format                                                         */
/* ------------------------------------------------------------------ */

export const SCENE_FORMAT_VERSION = 1 as const;

export interface SceneFile {
  format: "playstage-scene";
  version: typeof SCENE_FORMAT_VERSION;
  name: string;
  objects: SceneObject[];
  hotspots: CameraHotspot[];
  textures: TextureAsset[];
}

/* ------------------------------------------------------------------ */
/* Primitive parameter specs                                           */
/* ------------------------------------------------------------------ */

/**
 * Describes one editable number on a primitive.
 *
 * This is the single source of truth: default values, inspector labels, input
 * steps and the clamp range all come from here, so adding a primitive means
 * adding one entry rather than also writing a panel for it.
 */
export interface ParamSpec {
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  /** Segment counts must be whole numbers; dimensions need not be. */
  integer: boolean;
}

/** A continuous dimension: length, radius, height. */
function size(label: string, def: number, min = 0.01): ParamSpec {
  return { label, default: def, min, max: 1000, step: 0.1, integer: false };
}

/**
 * A tessellation count.
 *
 * The upper bound is the point: nothing otherwise stops a stray keystroke
 * asking for 50,000 radial segments and hanging the renderer while it builds
 * the buffers. 128 is far past the point of visible improvement at the scale
 * this tool draws at.
 */
function segments(label: string, def: number, min = 3, max = 128): ParamSpec {
  return { label, default: def, min, max, step: 1, integer: true };
}

export const PRIMITIVE_PARAMS: Record<
  PrimitiveKind,
  Record<string, ParamSpec>
> = {
  box: {
    width: size("Width", 1),
    height: size("Height", 1),
    depth: size("Depth", 1),
  },
  sphere: {
    radius: size("Radius", 0.5),
    widthSegments: segments("Segments", 32),
    heightSegments: segments("Rings", 16, 2),
  },
  cylinder: {
    // Radii may be zero, which collapses one end into a point. That is a
    // legitimate shape, so these allow 0 where other dimensions do not.
    radiusTop: size("Top radius", 0.5, 0),
    radiusBottom: size("Bottom radius", 0.5, 0),
    height: size("Height", 1),
    radialSegments: segments("Sides", 32),
  },
  cone: {
    radius: size("Radius", 0.5),
    height: size("Height", 1),
    radialSegments: segments("Sides", 32),
  },
  plane: {
    width: size("Width", 1),
    height: size("Height", 1),
  },
};

/** Default parameter bag per primitive, derived from the specs above. */
export const PRIMITIVE_DEFAULTS: Record<PrimitiveKind, PrimitiveParams> =
  Object.fromEntries(
    Object.entries(PRIMITIVE_PARAMS).map(([kind, specs]) => [
      kind,
      Object.fromEntries(
        Object.entries(specs).map(([name, spec]) => [name, spec.default]),
      ),
    ]),
  ) as Record<PrimitiveKind, PrimitiveParams>;

/**
 * Forces a value into a spec's range.
 *
 * Applied in the store rather than only in the input, so a value arriving from
 * a loaded scene file or a future script cannot produce geometry the renderer
 * chokes on.
 */
export function clampParam(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  const bounded = Math.min(spec.max, Math.max(spec.min, value));
  return spec.integer ? Math.round(bounded) : bounded;
}

/* ------------------------------------------------------------------ */
/* Other defaults                                                      */
/* ------------------------------------------------------------------ */

export const DEFAULT_MATERIAL: FaceMaterial = {
  textureId: null,
  color: "#c4c4be",
  tiling: [1, 1],
  offset: [0, 0],
  rotation: 0,
  doubleSided: false,
};

/** How many material slots each primitive exposes, i.e. how many separately
 *  texturable faces it has. */
export const PRIMITIVE_GROUP_COUNT: Record<PrimitiveKind, number> = {
  box: 6, // +x -x +y -y +z -z
  sphere: 1,
  cylinder: 3, // side, top cap, bottom cap
  cone: 2, // side, base cap
  plane: 1,
};

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};
