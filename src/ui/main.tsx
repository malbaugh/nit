import { IconoirProvider } from "iconoir-react";
import { Check, GitCompare, WarningCircle } from "iconoir-react/regular";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { handleKey } from "./actions";
import { DiffPane } from "./DiffPane";
import { FileList } from "./FileList";
import { OutlinePanel } from "./Outline";
import { Palette } from "./Palette";
import * as st from "./state";
import { EmptyState, Kbd } from "./ui";

const ICONS = { width: 15, height: 15, strokeWidth: 1.6 };

// ?debug exposes the store for poking at state from the console.
if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { nit: st });

function Toast() {
  const toast = st.useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <output
      key={toast.message}
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-card bg-surface py-2 pr-2 pl-3 text-[13px] text-ink shadow-overlay transition-[translate,opacity] duration-200 ease-out-strong starting:translate-y-2 starting:opacity-0"
    >
      <Check className="text-green" />
      <span className="pr-1">{toast.message}</span>
      {toast.undo ? (
        <button
          type="button"
          onClick={st.undo}
          className="flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 font-medium text-ink-2 transition-[background-color,color] duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink"
        >
          Undo <Kbd k="Mod+z" />
        </button>
      ) : null}
    </output>
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
    window.addEventListener("keydown", handleKey);
    // Coming back to the tab picks up edits made in the editor or by an agent.
    const onVisible = () => document.visibilityState === "visible" && st.get().editing === null && st.load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
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
      <Toast />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <IconoirProvider iconProps={ICONS}>
    <App />
  </IconoirProvider>,
);
