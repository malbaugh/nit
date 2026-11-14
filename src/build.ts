import { rmSync } from "node:fs";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

export const uiDir = join(import.meta.dir, "../dist/ui");

/** Bundles the browser UI (React + Tailwind) into dist/ui. */
export async function buildUI() {
  rmSync(uiDir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "ui/index.html")],
    outdir: uiDir,
    plugins: [tailwind],
    minify: true,
    splitting: true,
    sourcemap: "linked",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) throw new AggregateError(result.logs, "nit: UI build failed");
}

if (import.meta.main) {
  await buildUI();
  console.log(`built ${uiDir}`);
}
