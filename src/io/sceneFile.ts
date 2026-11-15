import type {
  CameraHotspot,
  FaceMaterial,
  GeometrySpec,
  PrimitiveKind,
  SceneFile,
  SceneObject,
  TextureAsset,
  Transform,
  Vec2,
  Vec3,
} from "../types/scene";
import {
  DEFAULT_MATERIAL,
  PRIMITIVE_GROUP_COUNT,
  PRIMITIVE_PARAMS,
  SCENE_FORMAT_VERSION,
  clampParam,
} from "../types/scene";

/**
 * Reading and writing the .playstage scene format.
 *
 * ## Why this file is defensive
 *
 * Everything that comes back off disk is untrusted input, even when Playstage
 * wrote it. A file can be hand-edited, truncated by a crash mid-write, synced
 * badly by OneDrive, or produced by a newer build. The renderer is not
 * tolerant of malformed input:
 *
 *   - `buildGeometry` THROWS on extrude/lathe/csg specs, and SceneObjectView
 *     calls it inside a useMemo with no error boundary. One such object in a
 *     file takes down the entire React tree.
 *   - A cycle in `parentId` makes SceneObjectView recurse until the stack
 *     overflows. `worldMatrix` guards against cycles; rendering does not.
 *   - A missing primitive param reaches Three.js as `undefined`, producing NaN
 *     vertex data: the mesh vanishes and raycasting misbehaves around it.
 *   - A zero scale component makes a parent's world matrix non-invertible, so
 *     reparenting a child through it yields NaN transforms.
 *
 * ## Repair, don't refuse
 *
 * The posture is deliberate: fix what can be fixed, report every fix, and
 * refuse only what is genuinely meaningless. This is a drawing tool, and
 * throwing away an afternoon's blockout because one object had a bad rotation
 * value would be indefensible. Only three things are fatal: the text is not
 * JSON, it is not a Playstage scene, or it comes from a future format version
 * whose meaning we cannot guess.
 */

export const SCENE_EXTENSION = "playstage";
export const SCENE_FILTER_NAME = "Playstage scene";

/** Smallest scale magnitude allowed, to keep parent matrices invertible. */
const MIN_SCALE = 1e-4;

const FOV_MIN = 10;
const FOV_MAX = 120;

/** Thrown for a file we cannot meaningfully open at all. */
export class SceneFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneFileError";
  }
}

export interface ParseResult {
  file: SceneFile;
  /** Human-readable list of repairs applied. Empty means a clean file. */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Serialises the scene as indented JSON.
 *
 * Indented rather than minified on purpose. These files are small, they are
 * the user's own data, and being able to open one in a text editor (or diff
 * two of them) is worth far more than the bytes saved.
 */
export function serializeScene(file: SceneFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/* ------------------------------------------------------------------ */
/* Primitive coercion helpers                                          */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asVec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return [
    asFiniteNumber(value[0], fallback[0]),
    asFiniteNumber(value[1], fallback[1]),
    asFiniteNumber(value[2], fallback[2]),
  ];
}

function asVec2(value: unknown, fallback: Vec2): Vec2 {
  if (!Array.isArray(value) || value.length !== 2) return [...fallback];
  return [
    asFiniteNumber(value[0], fallback[0]),
    asFiniteNumber(value[1], fallback[1]),
  ];
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Three.Color warns and silently keeps its old value on an unknown string,
 *  which would show the wrong colour with no clue why. Check it here. */
function asHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export function parseSceneFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SceneFileError(
      "This file is not valid JSON, so it is not a readable Playstage scene.",
    );
  }

  if (!isRecord(raw)) {
    throw new SceneFileError("This file does not contain a scene object.");
  }

  if (raw.format !== "playstage-scene") {
    throw new SceneFileError(
      "This is not a Playstage scene file (missing the playstage-scene marker).",
    );
  }

  const version = asFiniteNumber(raw.version, 0);
  if (version > SCENE_FORMAT_VERSION) {
    // Refusing beats guessing. A newer build may have added geometry kinds or
    // changed field meanings, and silently dropping what we don't recognise
    // would hand back a quietly wrong scene.
    throw new SceneFileError(
      `This scene was saved by a newer version of Playstage ` +
        `(format ${version}, this build reads up to ${SCENE_FORMAT_VERSION}).`,
    );
  }

  const warnings: string[] = [];
  const name = asString(raw.name, "Untitled");

  const textures = parseTextures(raw.textures, warnings);
  const textureIds = new Set(textures.map((t) => t.id));

  const objects = parseObjects(raw.objects, textureIds, warnings);
  const hotspots = parseHotspots(raw.hotspots, warnings);

  return {
    file: {
      format: "playstage-scene",
      version: SCENE_FORMAT_VERSION,
      name,
      objects,
      hotspots,
      textures,
    },
    warnings,
  };
}

/* ---------------- textures ---------------- */

function parseTextures(value: unknown, warnings: string[]): TextureAsset[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push("Texture list was not an array; ignored it.");
    return [];
  }

  const out: TextureAsset[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      name: asString(entry.name, "Texture"),
      path: asString(entry.path, ""),
      dataUrl: typeof entry.dataUrl === "string" ? entry.dataUrl : null,
    });
  }

  if (out.length !== value.length) {
    warnings.push(
      `Dropped ${value.length - out.length} unreadable texture entr` +
        `${value.length - out.length === 1 ? "y" : "ies"}.`,
    );
  }
  return out;
}

/* ---------------- objects ---------------- */

function parseObjects(
  value: unknown,
  textureIds: Set<string>,
  warnings: string[],
): SceneObject[] {
  if (!Array.isArray(value)) {
    warnings.push("Object list was missing or not an array; opened empty.");
    return [];
  }

  const parsed: SceneObject[] = [];
  const usedIds = new Set<string>();
  let renamedIds = 0;
  let dropped = 0;

  for (const entry of value) {
    if (!isRecord(entry)) {
      dropped++;
      continue;
    }

    // Duplicate or missing ids get fresh ones. A duplicate id would collide as
    // a React key and in the live-node registry; children referencing the
    // shared id stay attached to its first occurrence, which is the only
    // reading of an ambiguous file that keeps the hierarchy intact.
    let id = asString(entry.id, "");
    if (!id || usedIds.has(id)) {
      id = crypto.randomUUID();
      renamedIds++;
    }
    usedIds.add(id);

    const geometry = parseGeometry(entry.geometry, warnings, () =>
      asString(entry.name, "Object"),
    );

    parsed.push({
      id,
      name: asString(entry.name, "Object"),
      parentId: typeof entry.parentId === "string" ? entry.parentId : null,
      transform: parseTransform(entry.transform),
      geometry,
      materials: parseMaterials(entry.materials, geometry, textureIds),
      visible: asBoolean(entry.visible, true),
      locked: asBoolean(entry.locked, false),
    });
  }

  if (dropped > 0) {
    warnings.push(`Dropped ${dropped} malformed object entr${dropped === 1 ? "y" : "ies"}.`);
  }
  if (renamedIds > 0) {
    warnings.push(
      `Gave ${renamedIds} object${renamedIds === 1 ? "" : "s"} a new id ` +
        `(the saved ids were missing or duplicated).`,
    );
  }

  repairHierarchy(parsed, warnings);
  return parsed;
}

function parseTransform(value: unknown): Transform {
  const t = isRecord(value) ? value : {};
  const scale = asVec3(t.scale, [1, 1, 1]);

  return {
    position: asVec3(t.position, [0, 0, 0]),
    rotation: asVec3(t.rotation, [0, 0, 0]),
    // A zero component makes this object's world matrix singular, so any child
    // reparented through it decomposes to NaN. Nudge it off zero, keeping the
    // sign so mirrored objects stay mirrored.
    scale: scale.map((v) =>
      Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v,
    ) as Vec3,
  };
}

function parseGeometry(
  value: unknown,
  warnings: string[],
  describe: () => string,
): GeometrySpec {
  if (!isRecord(value)) return { kind: "group" };

  if (value.kind === "group") return { kind: "group" };

  if (value.kind === "primitive") {
    const kind = value.primitive;
    if (typeof kind !== "string" || !(kind in PRIMITIVE_PARAMS)) {
      warnings.push(
        `"${describe()}" had an unknown primitive type; loaded it as a group.`,
      );
      return { kind: "group" };
    }

    const primitive = kind as PrimitiveKind;
    const specs = PRIMITIVE_PARAMS[primitive];
    const saved = isRecord(value.params) ? value.params : {};

    // Built from the spec list, not from the file. A missing key would reach
    // Three.js as undefined and produce NaN geometry; an unknown key is just
    // dropped. Every value is clamped to its declared range.
    const params: Record<string, number> = {};
    for (const [paramName, spec] of Object.entries(specs)) {
      params[paramName] = clampParam(
        spec,
        asFiniteNumber(saved[paramName], spec.default),
      );
    }

    return { kind: "primitive", primitive, params };
  }

  // extrude / lathe / csg are declared in the type but not implemented, and
  // buildGeometry throws on them. Converting to a group keeps the object's
  // transform, its place in the hierarchy and all of its children, which is
  // far better than dropping the subtree.
  if (value.kind === "extrude" || value.kind === "lathe" || value.kind === "csg") {
    warnings.push(
      `"${describe()}" uses ${String(value.kind)} geometry, which this build ` +
        `cannot draw yet; loaded it as an empty group.`,
    );
    return { kind: "group" };
  }

  warnings.push(`"${describe()}" had unrecognised geometry; loaded it as a group.`);
  return { kind: "group" };
}

function parseMaterials(
  value: unknown,
  geometry: GeometrySpec,
  textureIds: Set<string>,
): Record<number, FaceMaterial> {
  if (geometry.kind !== "primitive") return {};

  const slots = PRIMITIVE_GROUP_COUNT[geometry.primitive];
  const saved = isRecord(value) ? value : {};
  const out: Record<number, FaceMaterial> = {};

  // Keyed by slot index from the primitive's own group count, so a file that
  // saved six box faces and is reloaded after the primitive changed shape
  // cannot leave holes or strays in the material list.
  for (let i = 0; i < slots; i++) {
    const entry = isRecord(saved[i]) ? (saved[i] as Record<string, unknown>) : {};
    const textureId = typeof entry.textureId === "string" ? entry.textureId : null;

    out[i] = {
      // A reference to a texture that is not in the file would render as a
      // missing map with no explanation. Fall back to flat colour.
      textureId: textureId && textureIds.has(textureId) ? textureId : null,
      color: asHexColor(entry.color, DEFAULT_MATERIAL.color),
      tiling: asVec2(entry.tiling, DEFAULT_MATERIAL.tiling),
      offset: asVec2(entry.offset, DEFAULT_MATERIAL.offset),
      rotation: asFiniteNumber(entry.rotation, DEFAULT_MATERIAL.rotation),
      doubleSided: asBoolean(entry.doubleSided, DEFAULT_MATERIAL.doubleSided),
    };
  }

  return out;
}

/**
 * Makes `parentId` links safe to render.
 *
 * Two separate hazards:
 *   - A parentId naming an object that is not in the file leaves the object in
 *     no bucket reachable from the root, so it silently never draws.
 *   - A cycle makes SceneObjectView recurse until the stack overflows.
 *
 * Both are repaired by cutting the offending link back to the root. The
 * cycle pass is a three-colour depth-first walk: grey means "on the current
 * path", so meeting grey again is proof of a loop.
 */
function repairHierarchy(objects: SceneObject[], warnings: string[]) {
  const byId = new Map(objects.map((o) => [o.id, o]));

  let orphans = 0;
  for (const o of objects) {
    if (o.parentId !== null && !byId.has(o.parentId)) {
      o.parentId = null;
      orphans++;
    }
  }
  if (orphans > 0) {
    warnings.push(
      `Moved ${orphans} object${orphans === 1 ? "" : "s"} to the top level ` +
        `(their parent was missing from the file).`,
    );
  }

  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>(objects.map((o) => [o.id, WHITE]));
  let cycles = 0;

  for (const start of objects) {
    if (colour.get(start.id) !== WHITE) continue;

    // Walk the parent chain iteratively; recursion here could overflow on the
    // same deep file we are trying to make safe.
    const path: SceneObject[] = [];
    let current: SceneObject | undefined = start;

    while (current) {
      const seenAs = colour.get(current.id);
      if (seenAs === GREY) {
        // current is already on this path: cut its link to break the loop.
        current.parentId = null;
        cycles++;
        break;
      }
      if (seenAs === BLACK) break;

      colour.set(current.id, GREY);
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    for (const node of path) colour.set(node.id, BLACK);
  }

  if (cycles > 0) {
    warnings.push(
      `Broke ${cycles} parent loop${cycles === 1 ? "" : "s"} by moving the ` +
        `looping object${cycles === 1 ? "" : "s"} to the top level.`,
    );
  }
}

/* ---------------- hotspots ---------------- */

function parseHotspots(value: unknown, warnings: string[]): CameraHotspot[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push("Camera hotspot list was not an array; ignored it.");
    return [];
  }

  const out: CameraHotspot[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    let id = asString(entry.id, "");
    if (!id || seen.has(id)) id = crypto.randomUUID();
    seen.add(id);

    const fov = asFiniteNumber(entry.fov, 50);

    out.push({
      id,
      name: asString(entry.name, "View"),
      position: asVec3(entry.position, [6, 5, 8]),
      target: asVec3(entry.target, [0, 0, 0]),
      fov: Math.min(FOV_MAX, Math.max(FOV_MIN, fov)),
    });
  }

  return out;
}
