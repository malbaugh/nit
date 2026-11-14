import type { FileDiffMetadata } from "@pierre/diffs";
import {
  ArrowRight,
  ChatLines,
  CheckCircle,
  GitBranch,
  PageEdit,
  PageMinus,
  PagePlus,
  Search,
} from "iconoir-react/regular";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stats } from "./lines";
import * as st from "./state";
import { basename, dirname, IconButton, Kbd, ProgressRing } from "./ui";

const statusIcon: Record<FileDiffMetadata["type"], { icon: React.ReactNode; label: string }> = {
  new: { icon: <PagePlus className="text-green" />, label: "Added" },
  deleted: { icon: <PageMinus className="text-red" />, label: "Deleted" },
  change: { icon: <PageEdit className="text-ink-3" />, label: "Modified" },
  "rename-pure": { icon: <ArrowRight className="text-ink-3" />, label: "Renamed" },
  "rename-changed": { icon: <ArrowRight className="text-ink-3" />, label: "Renamed" },
};

const Row = memo(function Row({
  file,
  index,
  active,
  viewed,
  comments,
  onHover,
}: {
  file: FileDiffMetadata;
  index: number;
  active: boolean;
  viewed: boolean;
  comments: number;
  onHover: (el: HTMLElement) => void;
}) {
  const { add, del } = stats(file);
  const status = statusIcon[file.type] ?? statusIcon.change;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: rows move with j/k on the listbox, not per row
    <div
      id={`file-${index}`}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      title={file.name}
      onMouseEnter={(e) => onHover(e.currentTarget)}
      onClick={() => st.openFile(index)}
      className={`relative flex h-7 cursor-default items-center gap-2 rounded-control px-2 [contain-intrinsic-size:auto_28px] [content-visibility:auto] ${
        active ? "bg-hover-2" : ""
      }`}
    >
      <span className="flex size-4 shrink-0 items-center justify-center" title={viewed ? "Viewed" : status.label}>
        {viewed ? <CheckCircle className="text-green" /> : status.icon}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span
          className={`shrink-0 ${viewed ? "text-ink-3" : active ? "text-ink" : "text-ink-2"} ${active ? "font-medium" : ""}`}
        >
          {basename(file.name)}
        </span>
        <span className="min-w-0 truncate text-[12px] text-ink-3">{dirname(file.name).replace(/\/$/, "")}</span>
      </span>
      {comments > 0 ? (
        <span
          className="flex shrink-0 items-center gap-0.5 text-[11.5px] text-orange tabular-nums"
          title={`${comments} draft comments`}
        >
          <ChatLines width={13} height={13} />
          {comments}
        </span>
      ) : null}
      <span className={`shrink-0 font-mono text-[11px] tabular-nums ${viewed ? "text-ink-3" : ""}`}>
        {add > 0 ? <span className={viewed ? "" : "text-green"}>+{add}</span> : null}
        {del > 0 ? <span className={`ml-1 ${viewed ? "" : "text-red"}`}>−{del}</span> : null}
      </span>
    </div>
  );
});

export function FileList() {
  const files = st.useStore((s) => s.files);
  const current = st.useStore((s) => s.current);
  const viewed = st.useStore((s) => s.viewed);
  const drafts = st.useStore((s) => s.drafts);
  const branch = st.useStore((s) => s.data?.branch);
  const base = st.useStore((s) => s.data?.base);
  const listRef = useRef<HTMLDivElement>(null);
  // Mouse hover glides between rows (transform only). Keyboard moves never animate.
  const [hover, setHover] = useState<{ y: number; h: number } | null>(null);

  const onHover = useCallback((el: HTMLElement) => setHover({ y: el.offsetTop, h: el.offsetHeight }), []);
  const commentsByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of drafts) m.set(d.path, (m.get(d.path) ?? 0) + 1);
    return m;
  }, [drafts]);
  const done = useMemo(() => files.reduce((n, f) => n + (viewed.has(f.name) ? 1 : 0), 0), [files, viewed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls whenever the current file changes
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <aside className="flex min-h-0 w-[272px] shrink-0 flex-col bg-canvas shadow-[1px_0_0_var(--line)]">
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
        <span
          className="ml-auto flex items-center gap-1.5 tabular-nums"
          title={`${done} of ${files.length} files viewed`}
        >
          <ProgressRing value={files.length ? done / files.length : 0} />
          {done}/{files.length}
        </span>
      </div>

      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="Changed files"
        aria-activedescendant={files[current] ? `file-${current}` : undefined}
        className="relative min-h-0 flex-1 overflow-y-auto px-1.5 pt-0.5 pb-2 outline-none"
        onMouseLeave={() => setHover(null)}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1.5 top-0 rounded-control bg-hover transition-[translate,opacity] duration-200 ease-out-strong"
          style={{ height: hover?.h ?? 0, translate: `0 ${hover?.y ?? 0}px`, opacity: hover ? 1 : 0 }}
        />
        {files.map((f, i) => (
          <Row
            key={f.name}
            file={f}
            index={i}
            active={i === current}
            viewed={viewed.has(f.name)}
            comments={commentsByPath.get(f.name) ?? 0}
            onHover={onHover}
          />
        ))}
      </div>

      <footer className="flex h-11 shrink-0 items-center gap-1 px-2 shadow-[0_-1px_0_var(--line)]">
        <button
          type="button"
          onClick={() => st.jumpDraft(1)}
          disabled={!drafts.length}
          className="flex h-7 items-center gap-1.5 rounded-control px-2 text-[12.5px] text-ink-2 transition-[background-color,color] duration-100 enabled:[@media(hover:hover)]:hover:bg-hover-2 enabled:[@media(hover:hover)]:hover:text-ink disabled:text-ink-3"
        >
          <ChatLines className={drafts.length ? "text-orange" : ""} />
          <span className="tabular-nums">
            {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}
          </span>
        </button>
        <span className="ml-auto flex items-center gap-1">
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
