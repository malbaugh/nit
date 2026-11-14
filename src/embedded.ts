import pkg from "../package.json" with { type: "json" };

/**
 * Files baked into the single binary: scripts/compile.ts fills these with paths inside the
 * executable before nit starts. Run from source they stay empty and nit reads its
 * files from disk.
 */
export const embedded = { ui: new Map<string, string>(), wasm: new Map<string, string>() };

export const compiled = () => embedded.ui.size > 0;

export const VERSION: string = pkg.version;
