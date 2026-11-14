import type { FileDiffMetadata } from "@pierre/diffs";
import { CheckCircle } from "iconoir-react/regular";
import { useMemo } from "react";
import { stats } from "./lines";
import * as st from "./state";

const LETTER: Record<FileDiffMetadata["type"], { text: string; ink: string }> = {
  new: { text: "A", ink: "text-green" },
  deleted: { text: "D", ink: "text-red" },
  change: { text: "M", ink: "text-orange" },
  "rename-pure": { text: "R", ink: "text-accent-ink" },
  "rename-changed": { text: "R", ink: "text-accent-ink" },
};

function Row({ index }: { index: number }) {
  const file = st.useStore((s) => s.files[index]);
  const current = st.useStore((s) => s.current === index);
  const viewed = st.useStore((s) => s.viewed.has(file.name));
  const changed = st.useStore((s) => s.changedSinceViewed.has(file.name));
  const drafts = st.useStore((s) => s.drafts.filter((d) => d.path === file.name).length);
  const { add, del } = stats(file);
  const slash = file.name.lastIndexOf("/");
  const letter = LETTER[file.type];
  return (
    <button
      type="button"
      onClick={() => st.openFile(index)}
      aria-current={current ? "true" : undefined}
      title={file.name}
      className={`flex h-7 w-full items-center gap-2 rounded-[6px] pr-2 pl-6 text-left text-[12.5px] transition-[background-color] duration-100 ${
        current ? "bg-hover-2 text-ink" : "text-ink-2 [@media(hover:hover)]:hover:bg-hover"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className={viewed ? "text-ink-3" : ""}>{file.name.slice(slash + 1)}</span>
        {slash > 0 ? <span className="ml-1.5 text-[11.5px] text-ink-3">{file.name.slice(0, slash)}</span> : null}
      </span>
      {viewed ? (
        <CheckCircle width={14} height={14} className="shrink-0 text-ink-3" />
      ) : changed ? (
        <span
          className="size-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--orange)]"
          title="Changed since you viewed it"
        />
      ) : (
        <span className="shrink-0 text-[11.5px] tabular-nums">
          {drafts ? <span className="mr-1.5 text-orange">{drafts}</span> : null}
          {add ? <span className="text-green">+{add}</span> : null}
          {add && del ? " " : null}
          {del ? <span className="text-red">−{del}</span> : null}
        </span>
      )}
      <span className={`w-2.5 shrink-0 text-center font-mono text-[10.5px] ${letter.ink}`}>{letter.text}</span>
    </button>
  );
}

/**
 * The files in the order Claude suggests reading them: chapters of a few files that belong
 * together, the heart of the change first. j / k walk it in this order.
 */
export function GuideList() {
  const guide = st.useStore((s) => s.data?.guide);
  const files = st.useStore((s) => s.files);
  // Hidden files (generated, tests…) stay out, as in the tree.
  const shown = st.useStore((s) => s.files.map((f) => (st.hiddenFile(f.name, s) ? "0" : "1")).join(""));
  const at = useMemo(() => new Map(files.map((f, i) => [f.name, i])), [files]);
  const chapters = useMemo(
    () =>
      (guide ?? [])
        .map((c) => ({ ...c, rows: c.files.flatMap((n) => at.get(n) ?? []).filter((i) => shown[i] === "1") }))
        .filter((c) => c.rows.length),
    [guide, at, shown],
  );
  return (
    <nav aria-label="Files in reading order" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      {chapters.map((c, n) => (
        <section key={c.title} className="pt-2">
          <h3 className="flex items-baseline gap-2 px-2 text-[12px] font-medium text-ink">
            <span className="w-2.5 shrink-0 text-ink-3 tabular-nums">{n + 1}</span>
            <span className="min-w-0">{c.title}</span>
          </h3>
          <p className="mb-1 pr-2 pl-6.5 text-[11.5px] leading-4 text-ink-3">{c.why}</p>
          {c.rows.map((i) => (
            <Row key={i} index={i} />
          ))}
        </section>
      ))}
    </nav>
  );
}
