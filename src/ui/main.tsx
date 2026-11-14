import { Toast } from "@base-ui/react/toast";
import { IconoirProvider } from "iconoir-react";
import { Check, GitCompare, WarningCircle } from "iconoir-react/regular";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { handleKey } from "./actions";
import { DiffPane } from "./DiffPane";
import { FileList } from "./FileList";
import { OutlinePanel } from "./Outline";
import { Palette } from "./Palette";
import { ReviewSheet } from "./ReviewSheet";
import * as st from "./state";
import { toasts } from "./toasts";
import { EmptyState, Kbd, TooltipProvider } from "./ui";

const ICONS = { width: 15, height: 15, strokeWidth: 1.6 };

// ?debug exposes the store for poking at state from the console.
if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { nit: st });

/** Base UI toasts (stacking, swipe to dismiss, timers pause on hover) in nit's look. */
function Toasts() {
  const { toasts: list } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed bottom-4 left-1/2 z-40 w-[min(420px,calc(100vw-32px))] -translate-x-1/2">
        {list.map((t) => (
          <Toast.Root
            key={t.id}
            toast={t}
            className="absolute bottom-0 left-0 flex w-full items-center gap-2.5 rounded-card bg-surface py-2 pr-2 pl-3 text-[13px] text-ink shadow-overlay [transform:translateY(calc(var(--toast-index)*-6px))_scale(calc(1-var(--toast-index)*0.04))] transition-[transform,opacity] duration-200 ease-out-strong data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:[transform:translateY(8px)] data-starting-style:opacity-0"
          >
            <Check className="shrink-0 text-green" />
            <Toast.Title className="min-w-0 flex-1 truncate" />
            {t.actionProps ? (
              <Toast.Action className="flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 font-medium text-ink-2 transition-[background-color,color] duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink" />
            ) : null}
            {(t.data as { undo?: boolean } | undefined)?.undo ? <Kbd k="Mod+z" /> : null}
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

function App() {
  const hasData = st.useStore((s) => s.data !== null);
  const base = st.useStore((s) => s.data?.base);
  const error = st.useStore((s) => s.error);
  const count = st.useStore((s) => s.files.length);
  const sidebar = st.useStore((s) => s.sidebar);
  const outlineOpen = st.useStore((s) => s.outlineOpen);

  useEffect(() => {
    st.load().then(st.restoreBackups);
    void st.loadGitHub();
    // Threads refresh every minute while the tab is visible (and when you come back to it).
    const poll = setInterval(() => document.visibilityState === "visible" && st.loadGitHub(), 60_000);
    window.addEventListener("keydown", handleKey);
    // Coming back to the tab picks up edits made in the editor or by an agent.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (st.get().editing === null) void st.load();
      void st.loadGitHub();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (error && !hasData)
    return (
      <EmptyState
        icon={<WarningCircle />}
        title="Couldn't load the review"
        body="Check that nit is still running in your terminal, then reload this tab."
      />
    );
  // Loading locally takes a few milliseconds; showing nothing avoids a spinner flash.
  if (!hasData) return null;
  if (!count)
    return (
      <EmptyState
        icon={<GitCompare />}
        title={`No changes against ${base}`}
        body="Commit, stage or edit something, then come back to this tab."
      />
    );

  return (
    <div className="flex h-full">
      {sidebar ? <FileList /> : null}
      <DiffPane />
      {outlineOpen ? <OutlinePanel /> : null}
      <Palette />
      <ReviewSheet />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <IconoirProvider iconProps={ICONS}>
    <TooltipProvider>
      <Toast.Provider toastManager={toasts} limit={3}>
        <App />
        <Toasts />
      </Toast.Provider>
    </TooltipProvider>
  </IconoirProvider>,
);
