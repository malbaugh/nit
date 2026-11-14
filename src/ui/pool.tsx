import { useWorkerPool, WorkerPoolContextProvider, type WorkerPoolOptions } from "@pierre/diffs/react";
import { type ReactNode, useEffect } from "react";
import { HIGHLIGHTER } from "./Code";
import { useTheme } from "./theme";

/**
 * Highlighting for every diff and file view. Pierre's recommended setup: Highlights on the
 * main thread for anything up to 100k characters (about 2ms), a worker for bigger files so a
 * 300 KB file paints plain text at once instead of blocking ~60ms. Results are cached by the
 * diff's cacheKey, so going back to a file is instant.
 */
const POOL: WorkerPoolOptions = {
  workerFactory: () => new Worker("/worker-portable.js"),
  poolSize: 2,
  mainThreadMaxCharacters: 100_000,
};

/** The pool owns theme and token options; this keeps it on the chosen theme. */
function ThemeSync() {
  const pool = useWorkerPool();
  const { darkThemeName: dark, lightThemeName: light } = useTheme();
  useEffect(() => {
    void pool?.setRenderOptions({ theme: { dark, light } });
  }, [pool, dark, light]);
  return null;
}

export function HighlightPool({ children }: { children: ReactNode }) {
  const { darkThemeName: dark, lightThemeName: light } = useTheme();
  return (
    <WorkerPoolContextProvider
      poolOptions={POOL}
      highlighterOptions={{
        theme: { dark, light },
        preferredHighlighter: HIGHLIGHTER,
        lineDiffType: "word-alt",
        // ⌘-click and link hover need per-token elements.
        useTokenTransformer: true,
      }}
    >
      <ThemeSync />
      {children}
    </WorkerPoolContextProvider>
  );
}
