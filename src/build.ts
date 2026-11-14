import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const root = join(import.meta.dir, "..");
/** Dev servers (NIT_DEV=1) build apart, so a dev run never swaps the UI under a running nit. */
export const uiDirFor = (dev: boolean) => join(root, dev ? "dist/ui-dev" : "dist/ui");

/** Newest modification time under the UI's sources (the UI and the types it shares). */
function sourcesChanged() {
  let newest = statSync(join(import.meta.dir, "types.ts")).mtimeMs;
  for (const entry of readdirSync(join(import.meta.dir, "ui"), { recursive: true, withFileTypes: true }))
    if (entry.isFile()) newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs);
  return newest;
}

/** The build is missing or older than its sources: a restart after an update rebuilds. */
export function isStale(dir: string) {
  try {
    return statSync(join(dir, "index.html")).mtimeMs < sourcesChanged();
  } catch {
    return true;
  }
}

/** Bundles the browser UI (React + Tailwind) into `dir`. */
export async function buildUI(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "ui/index.html")],
    outdir: dir,
    plugins: [tailwind],
    minify: true,
    splitting: true,
    sourcemap: "linked",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) throw new AggregateError(result.logs, "nit: UI build failed");
}

if (import.meta.main) {
  const dir = uiDirFor(false);
  await buildUI(dir);
  console.log(`built ${dir}`);
}
