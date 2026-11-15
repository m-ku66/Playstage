/**
 * Module resolution hook: lets Node import the project's own extensionless
 * TypeScript specifiers.
 *
 * The source uses bundler-style imports (`from "../types/scene"`), because
 * that is what Vite and tsc want. Node's ESM resolver requires a real file
 * extension, so a harness that imports actual source fails on the first
 * runtime import.
 *
 * verify-hierarchy.mjs got away without this because hierarchy.ts only imports
 * TYPES from scene.ts, and type-only imports are erased before Node ever tries
 * to resolve them. The moment a module imports a real value, this is needed.
 *
 * Only relative, extensionless specifiers are retried, and only after the
 * normal resolution has already failed — so package imports and anything that
 * resolves on its own are untouched.
 */

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[a-zA-Z0-9]+$/;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const recoverable =
      err?.code === "ERR_MODULE_NOT_FOUND" ||
      err?.code === "ERR_UNSUPPORTED_DIR_IMPORT";

    if (
      recoverable &&
      RELATIVE.test(specifier) &&
      !HAS_EXTENSION.test(specifier)
    ) {
      // Try the two shapes a bundler would have accepted, in that order.
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          // fall through to the next candidate
        }
      }
    }
    throw err;
  }
}
