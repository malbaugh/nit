import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { AlignJustify, ChatPlusIn, Check, ViewColumns2 } from "iconoir-react/regular";
import { useCallback, useEffect, useMemo } from "react";
import { DraftAnnotation } from "./Comments";
import { stats } from "./lines";
import * as st from "./state";
import { basename, dirname, IconButton, Segmented, Tooltip } from "./ui";

type Meta = { id: string };

/** Pierre draws lines inside a shadow root; find the row for one side + line number. */
function revealLine(side: "additions" | "deletions", line: number) {
  const root = document.querySelector("diffs-container")?.shadowRoot;
  if (!root) return;
  const rows = [...root.querySelectorAll<HTMLElement>(`[data-line="${line}"]`)];
  const want = side === "additions" ? "addition" : "deletion";
  const el = rows.find((r) => r.dataset.lineType?.includes(want)) ?? rows.find((r) => r.dataset.lineType === "context");
  el?.scrollIntoView({ block: "nearest" });
}

// Inside Pierre's shadow root: the cursor row, quiet separators, and the comment gutter button.
const DIFF_CSS = `
[data-line][data-selected-line] { box-shadow: inset 2px 0 0 var(--accent), inset 0 0 0 999px var(--accent-tint); }
[data-separator-content] { font-family: var(--diffs-header-font-family); font-size: 12px; letter-spacing: -0.005em; color: var(--ink-3); }
[data-expand-button] { color: var(--ink-3); transition: color 100ms, background-color 100ms; }
@media (hover: hover) { [data-expand-button]:hover { color: var(--ink); background-color: var(--hover-2); } }
[data-gutter-utility-slot] button { background: var(--accent); color: white; border-radius: 6px; box-shadow: 0 1px 2px oklch(0 0 0 / 0.25); }
`;

const toPoint = (side: SelectedLineRange["side"], line: number) => ({ side: side ?? ("additions" as const), line });

const STYLE_OPTIONS = [
  { value: "split" as const, label: "Split", icon: <ViewColumns2 width={14} height={14} />, keys: "s" },
  { value: "unified" as const, label: "Unified", icon: <AlignJustify width={14} height={14} />, keys: "s" },
];

export function DiffPane() {
  const file = st.useStore((s) => st.currentFile(s));
  const style = st.useStore((s) => s.style);
  const viewed = st.useStore((s) => (file ? s.viewed.has(file.name) : false));
  const drafts = st.useStore((s) => s.drafts);
  const cursor = st.useStore((s) => s.cursor);
  const anchor = st.useStore((s) => s.anchor);

  const options = useMemo(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system" as const,
      diffStyle: style,
      diffIndicators: "bars" as const,
      lineDiffType: "word-alt" as const,
      hunkSeparators: "line-info" as const,
      disableFileHeader: true,
      enableGutterUtility: true,
      enableLineSelection: true,
      controlledSelection: true,
      lineHoverHighlight: "number" as const,
      unsafeCSS: DIFF_CSS,
      onLineSelected: (range: SelectedLineRange | null) => {
        if (range) st.setSelection(toPoint(range.side, range.start), toPoint(range.endSide ?? range.side, range.end));
      },
      onGutterUtilityClick: (range: SelectedLineRange) => {
        st.setSelection(toPoint(range.side, range.start), toPoint(range.endSide ?? range.side, range.end));
        st.startComment();
      },
    }),
    [style],
  );

  const annotations = useMemo<DiffLineAnnotation<Meta>[]>(
    () =>
      file
        ? drafts
            .filter((d) => d.path === file.name)
            .map((d) => ({ side: d.side, lineNumber: d.end, metadata: { id: d.id } }))
        : [],
    [drafts, file],
  );

  const selected = useMemo<SelectedLineRange | null>(() => {
    if (!cursor) return null;
    const from = anchor ?? cursor;
    return { start: from.line, side: from.side, end: cursor.line, endSide: cursor.side };
  }, [cursor, anchor]);

  useEffect(() => {
    if (cursor) revealLine(cursor.side, cursor.line);
  }, [cursor]);

  const renderAnnotation = useCallback((a: DiffLineAnnotation<Meta>) => <DraftAnnotation id={a.metadata.id} />, []);

  if (!file) return null;
  const { add, del } = stats(file);
  const dirs = dirname(file.name).split("/").filter(Boolean);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-page">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4 shadow-[0_1px_0_var(--line)]">
        <nav aria-label="File path" className="flex min-w-0 items-center gap-1 text-[13px]">
          {file.prevName ? (
            <span className="truncate text-ink-3" title={`Renamed from ${file.prevName}`}>
              {basename(file.prevName)} →
            </span>
          ) : null}
          {dirs.map((d, i) => (
            <span key={`${i}:${d}`} className="flex shrink items-center gap-1 truncate text-ink-3">
              <span className="truncate">{d}</span>
              <span className="text-line-strong">/</span>
            </span>
          ))}
          <span className="shrink-0 font-medium text-ink">{basename(file.name)}</span>
        </nav>
        <span className="flex h-[22px] shrink-0 items-center gap-1.5 rounded-chip bg-inset px-1.5 font-mono text-[11.5px] tabular-nums shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="text-green">+{add}</span>
          <span className="text-red">−{del}</span>
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <IconButton label="Comment on file" keys="C" onClick={st.startFileComment}>
            <ChatPlusIn />
          </IconButton>
          <Segmented
            label="Diff layout"
            value={style}
            options={STYLE_OPTIONS}
            onChange={(v) => v !== style && st.toggleStyle()}
          />
          <Tooltip label={viewed ? "Mark as not viewed" : "Mark as viewed"} keys="v">
            <button
              type="button"
              aria-pressed={viewed}
              onClick={() => st.toggleViewed()}
              className={`flex h-7 items-center gap-1.5 rounded-control pr-2.5 pl-2 text-[12.5px] font-medium transition-[background-color,color,transform,box-shadow] duration-100 active:scale-[0.97] ${
                viewed
                  ? "bg-green-tint text-green shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--green)_30%,transparent)]"
                  : "bg-surface text-ink-2 shadow-btn [@media(hover:hover)]:hover:text-ink"
              }`}
            >
              <span
                aria-hidden
                className={`flex size-3.5 items-center justify-center rounded-[4px] transition-[background-color,box-shadow] duration-100 ${
                  viewed ? "bg-green text-page" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)]"
                }`}
              >
                {viewed ? <Check width={11} height={11} strokeWidth={2.5} /> : null}
              </span>
              Viewed
            </button>
          </Tooltip>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <FileDiff<Meta, undefined>
          key={file.name}
          fileDiff={file}
          options={options}
          lineAnnotations={annotations}
          renderAnnotation={renderAnnotation}
          selectedLines={selected}
        />
      </div>
    </main>
  );
}
