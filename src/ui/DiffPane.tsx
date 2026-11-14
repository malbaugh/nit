import type { DiffLineAnnotation, DiffTokenEventBaseProps, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import {
  AlignJustify,
  ChatPlusIn,
  Check,
  Expand,
  NavArrowRight,
  SidebarExpand,
  ViewColumns2,
} from "iconoir-react/regular";
import { useCallback, useEffect, useMemo } from "react";
import { DraftAnnotation } from "./Comments";
import { stats } from "./lines";
import * as nav from "./nav";
import { PeekAnnotation } from "./Peek";
import * as st from "./state";
import { ThreadAnnotation } from "./Threads";
import { useTheme } from "./theme";
import { basename, dirname, IconButton, Segmented, Toggle, Tooltip } from "./ui";

type Meta = { id: string } | { peek: true } | { thread: string };

/** Pierre draws lines inside a shadow root; find the row for one side + line number. */
function findRow(side: "additions" | "deletions", line: number) {
  const root = document.querySelector("diffs-container")?.shadowRoot;
  const rows = root?.querySelectorAll<HTMLElement>(`[data-line="${line}"]`) ?? [];
  // Pierre's own rule (getAnnotationSide): a change row's type names its side; any other row
  // takes its column's, where only the split view's old column has data-deletions.
  return [...rows].find((r) => {
    const type = r.dataset.lineType;
    if (type === "change-deletion") return side === "deletions";
    if (type === "change-addition") return side === "additions";
    return r.closest("[data-deletions]") ? side === "deletions" : side === "additions";
  });
}

/**
 * Brings the cursor row into view, vertically only (scrollIntoView would also shift a wide split
 * view sideways). Off screen (a jump) centres it; near an edge (j/k) nudges it. A freshly
 * remounted diff draws a frame or two late, so it retries briefly.
 */
export function revealLine(side: "additions" | "deletions", line: number, tries = 10) {
  const el = findRow(side, line);
  const scroller = document.querySelector<HTMLElement>("[data-diff-scroll]");
  if (!el || !scroller) {
    if (tries > 0) requestAnimationFrame(() => revealLine(side, line, tries - 1));
    return;
  }
  const row = el.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const margin = 48;
  if (row.bottom < box.top || row.top > box.bottom)
    scroller.scrollTop += row.top - box.top - (box.height - row.height) / 2;
  else if (row.top < box.top + margin) scroller.scrollTop -= box.top + margin - row.top;
  else if (row.bottom > box.bottom - margin) scroller.scrollTop += row.bottom - (box.bottom - margin);
}

// Inside Pierre's shadow root: the cursor row, quiet separators, and the comment gutter button.
export const DIFF_CSS = `
[data-line][data-selected-line] { box-shadow: inset 2px 0 0 var(--accent), inset 0 0 0 999px var(--accent-tint); }
[data-separator-content] { font-family: var(--diffs-header-font-family); font-size: 12px; letter-spacing: -0.005em; color: var(--ink-3); }
[data-expand-button] { color: var(--ink-3); transition: color 100ms, background-color 100ms; }
@media (hover: hover) { [data-expand-button]:hover { color: var(--ink); background-color: var(--hover-2); } }
[data-gutter-utility-slot] button { background: var(--accent); color: white; border-radius: 6px; box-shadow: 0 1px 2px oklch(0 0 0 / 0.25); }
[data-nit-link] { text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
`;

/** ⌘ (Ctrl elsewhere) held over a word underlines it, like an editor's go-to-definition link. */
export const linkKey = (e: MouseEvent) => e.metaKey || e.ctrlKey;

const toPoint = (side: SelectedLineRange["side"], line: number) => ({ side: side ?? ("additions" as const), line });

const STYLE_OPTIONS = [
  { value: "split" as const, label: "Split", icon: <ViewColumns2 width={14} height={14} />, keys: "s" },
  { value: "unified" as const, label: "Unified", icon: <AlignJustify width={14} height={14} />, keys: "s" },
];

export function DiffPane() {
  const file = st.useStore((s) => st.currentFile(s));
  const style = st.useStore((s) => s.style);
  // Pierre throws on expandUnchanged for a partial diff, so only once the file's full text is in.
  const full = st.useStore((s) => (file ? s.fullFiles.has(file.name) && !file.isPartial : false));
  const viewed = st.useStore((s) => (file ? s.viewed.has(file.name) : false));
  const drafts = st.useStore((s) => s.drafts);
  const cursor = st.useStore((s) => s.cursor);
  const anchor = st.useStore((s) => s.anchor);

  const { darkThemeName: darkTheme, lightThemeName: lightTheme, resolvedColorScheme: scheme } = useTheme();

  const options = useMemo(
    () => ({
      theme: { dark: darkTheme, light: lightTheme },
      themeType: scheme,
      diffStyle: style,
      expandUnchanged: full,
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
      onTokenEnter: (t: DiffTokenEventBaseProps, e: PointerEvent) => {
        if (linkKey(e)) t.tokenElement.setAttribute("data-nit-link", "");
      },
      onTokenLeave: (t: DiffTokenEventBaseProps) => t.tokenElement.removeAttribute("data-nit-link"),
      onTokenClick: (t: DiffTokenEventBaseProps, e: MouseEvent) => {
        if (!linkKey(e)) return;
        e.preventDefault();
        st.set({ cursor: { side: t.side, line: t.lineNumber }, anchor: null });
        void nav.lookup("definition", { col: t.lineCharStart });
      },
    }),
    [style, full, darkTheme, lightTheme, scheme],
  );

  const peekAt = st.useStore((s) => s.peek?.at);
  const threads = st.useStore((s) => (s.github?.status === "ready" ? s.github.threads : null));
  const outline = st.useStore((s) => (file ? s.outlines[file.name] : undefined));
  const sidebar = st.useStore((s) => s.sidebar);

  useEffect(() => {
    if (file) nav.loadOutline(file.name, file.prevName);
  }, [file]);

  const annotations = useMemo<DiffLineAnnotation<Meta>[]>(() => {
    if (!file) return [];
    // Replies render inside their thread, not on their own.
    const list: DiffLineAnnotation<Meta>[] = drafts
      .filter((d) => d.path === file.name && !d.replyTo)
      .map((d) => ({ side: d.side, lineNumber: d.end, metadata: { id: d.id } }));
    for (const t of threads ?? []) {
      if (t.path !== file.name) continue;
      // File-level and outdated threads sit above the first change.
      const placed = t.line !== null && !t.outdated && t.subject === "line";
      list.push({
        side: placed ? t.side : "additions",
        lineNumber: placed ? (t.line ?? 0) : 0,
        metadata: { thread: t.id },
      });
    }
    if (peekAt) list.push({ side: peekAt.side, lineNumber: peekAt.line, metadata: { peek: true } });
    return list;
  }, [drafts, file, peekAt, threads]);

  const selected = useMemo<SelectedLineRange | null>(() => {
    if (!cursor) return null;
    const from = anchor ?? cursor;
    return { start: from.line, side: from.side, end: cursor.line, endSide: cursor.side };
  }, [cursor, anchor]);

  useEffect(() => {
    if (cursor) revealLine(cursor.side, cursor.line);
  }, [cursor]);

  const renderAnnotation = useCallback(
    (a: DiffLineAnnotation<Meta>) =>
      "peek" in a.metadata ? (
        <PeekAnnotation />
      ) : "thread" in a.metadata ? (
        <ThreadAnnotation id={a.metadata.thread} />
      ) : (
        <DraftAnnotation id={a.metadata.id} />
      ),
    [],
  );

  if (!file) return null;
  const { add, del } = stats(file);
  const dirs = dirname(file.name).split("/").filter(Boolean);
  // Which function or class the cursor is in, from the side it's on.
  const scope = cursor
    ? nav.enclosing(cursor.side === "additions" ? outline?.new : outline?.old, cursor.line).slice(-2)
    : [];

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-page">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4 shadow-[0_1px_0_var(--line)]">
        {!sidebar ? (
          <IconButton label="Show file list" keys="Mod+\\" onClick={() => st.set({ sidebar: true })}>
            <SidebarExpand />
          </IconButton>
        ) : null}
        <nav aria-label="File path" className="flex min-w-0 items-center gap-1 overflow-hidden text-[13px]">
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
          <span className="min-w-[4ch] truncate font-medium text-ink">{basename(file.name)}</span>
          {scope.map((sym) => (
            <span key={`${sym.line}:${sym.name}`} className="flex min-w-0 shrink items-center gap-1 text-ink-2">
              <NavArrowRight width={12} height={12} className="shrink-0 text-ink-3" />
              <span className="truncate font-mono text-[12px]">{sym.name}</span>
            </span>
          ))}
        </nav>
        <span className="flex h-[22px] shrink-0 items-center gap-1.5 rounded-chip bg-inset px-1.5 font-mono text-[11.5px] tabular-nums shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="text-green">+{add}</span>
          <span className="text-red">−{del}</span>
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <IconButton
            label={full ? "Fold unchanged lines" : "Show the whole file"}
            keys="f"
            onClick={() => void st.setFullFile(file.name, !full)}
            className={full ? "bg-hover-2 text-ink" : ""}
          >
            <Expand />
          </IconButton>
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
            <Toggle
              pressed={viewed}
              onPressedChange={() => st.toggleViewed()}
              className="group/viewed flex h-7 items-center gap-1.5 rounded-control bg-surface pr-2.5 pl-2 text-[12.5px] font-medium text-ink-2 shadow-btn transition-[background-color,color,transform,box-shadow] duration-100 active:scale-[0.97] data-pressed:bg-green-tint data-pressed:text-green data-pressed:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--green)_30%,transparent)] [@media(hover:hover)]:hover:text-ink [@media(hover:hover)]:data-pressed:hover:text-green"
            >
              <span
                aria-hidden
                className="flex size-3.5 items-center justify-center rounded-[4px] shadow-[inset_0_0_0_1.5px_var(--line-strong)] transition-[background-color,box-shadow] duration-100 group-data-pressed/viewed:bg-green group-data-pressed/viewed:text-page group-data-pressed/viewed:shadow-none"
              >
                {viewed ? <Check width={11} height={11} strokeWidth={2.5} /> : null}
              </span>
              Viewed
            </Toggle>
          </Tooltip>
        </div>
      </header>
      <div data-diff-scroll className="min-h-0 flex-1 overflow-auto">
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
