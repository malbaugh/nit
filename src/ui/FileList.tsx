import { ChatLines, GitBranch, Search } from "iconoir-react/regular";
import { useMemo } from "react";
import { ChangedTree } from "./ChangedTree";
import { SettingsButton } from "./Settings";
import * as st from "./state";
import { IconButton, Kbd, ProgressRing, Resizer } from "./ui";

export function FileList() {
  const agentRunning = st.useStore((s) => s.agent?.state === "running" || s.job?.state === "running");
  const jobKind = st.useStore((s) => (s.job?.state === "running" ? s.job.kind : null));
  const agentCount = st.useStore((s) => s.agent?.drafts.length ?? 0);
  const width = st.useStore((s) => s.widths.files);
  const files = st.useStore((s) => s.files);
  const viewed = st.useStore((s) => s.viewed);
  const changed = st.useStore((s) => s.changedSinceViewed.size);
  const drafts = st.useStore((s) => s.drafts);
  const branch = st.useStore((s) => s.data?.branch);
  const base = st.useStore((s) => s.data?.base);
  const done = useMemo(() => files.reduce((n, f) => n + (viewed.has(f.name) ? 1 : 0), 0), [files, viewed]);

  return (
    <aside className="relative flex min-h-0 shrink-0 flex-col bg-canvas shadow-[1px_0_0_var(--line)]" style={{ width }}>
      <Resizer
        edge="right"
        label="Resize the file tree"
        value={width}
        min={200}
        max={st.maxWidth("files")}
        onChange={(px) => st.setWidth("files", px)}
        onReset={() => st.setWidth("files", st.DEFAULT_WIDTHS.files)}
      />
      <header className="flex h-12 shrink-0 items-center gap-2 px-3.5">
        <GitBranch className="shrink-0 text-ink-3" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-ink" title={branch}>
            {branch}
          </span>
          <span className="shrink-0 text-[12px] text-ink-3">into</span>
          <span className="truncate font-mono text-[11.5px] text-ink-2" title={base}>
            {base}
          </span>
        </div>
      </header>

      <div className="flex h-7 shrink-0 items-center gap-2 px-3.5 text-[12px] text-ink-3">
        <span className="font-medium text-ink-2">Files</span>
        <span className="tabular-nums">{files.length}</span>
        {changed ? (
          <span className="text-orange tabular-nums" title="Files you marked viewed that changed since">
            · {changed} changed since viewed
          </span>
        ) : null}
        <span
          className="ml-auto flex items-center gap-1.5 tabular-nums"
          title={`${done} of ${files.length} files viewed`}
        >
          <ProgressRing value={files.length ? done / files.length : 0} />
          {done}/{files.length}
        </span>
      </div>

      <ChangedTree />

      <footer className="flex h-11 shrink-0 items-center gap-1 px-2 shadow-[0_-1px_0_var(--line)]">
        {agentRunning ? (
          <button
            type="button"
            onClick={() => st.set({ agentOpen: true })}
            className="flex h-7 min-w-0 items-center gap-2 rounded-control px-2 text-[12.5px] text-ink-2 transition-[background-color,color] duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink"
          >
            <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-accent" />
            <span className="truncate">
              {jobKind === "review"
                ? "Claude is reviewing…"
                : jobKind === "ask"
                  ? "Claude is answering…"
                  : `Claude is applying ${agentCount}…`}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => st.set({ reviewOpen: true })}
            disabled={!drafts.length}
            className="flex h-7 items-center gap-1.5 rounded-control px-2 text-[12.5px] text-ink-2 transition-[background-color,color] duration-100 enabled:[@media(hover:hover)]:hover:bg-hover-2 enabled:[@media(hover:hover)]:hover:text-ink disabled:text-ink-3"
          >
            <ChatLines className={drafts.length ? "text-orange" : ""} />
            <span className="tabular-nums">
              {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}
            </span>
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          <SettingsButton />
          <Kbd k="Mod+k" quiet />
          <IconButton
            label="Search files and actions"
            keys="Mod+k"
            side="top"
            onClick={() => st.set({ palette: "all" })}
          >
            <Search />
          </IconButton>
        </span>
      </footer>
    </aside>
  );
}
