/**
 * Installs the extensionless-TypeScript resolver for the verify harnesses.
 *
 * Used as `node --experimental-strip-types --import ./scripts/register-ts.mjs`.
 * Resolution hooks have to be registered from a module that loads before the
 * entry point, which is what --import is for.
 */
import { register } from "node:module";

register("./ts-extension-hook.mjs", import.meta.url);
