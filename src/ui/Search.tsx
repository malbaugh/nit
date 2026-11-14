import { DocMagnifyingGlass, Xmark } from "iconoir-react/regular";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GroupedVirtuoso, type GroupedVirtuosoHandle } from "react-virtuoso";
import type { SearchMatch } from "../types";
import { api } from "./api";
import { CodeBlock, langFor } from "./Code";
import { rangeIn } from "./marks";
import * as nav from "./nav";
import * as st from "./state";
import { basename, dirname, IconButton, Kbd, Tooltip } from "./ui";

type Results = { key: string; matches: SearchMatch[]; next: string | null; regexError?: string; error?: string };

/** A run of lines from one file: one or more matches with the lines around them. */
type Excerpt = { path: string; start: number; lines: string[]; hits: Map<number, [number, number][]> };

// Coming back to the screen (Back from a result) shows the same results at the same match.
const memo: { results: Results | null; active: number } = { results: null, active: 0 };

const keyOf = (s: st.State["search"]) => `${s.regex ? 1 : 0}${s.caseSensitive ? 1 : 0}${s.query}`;

/** Groups matches by file and merges matches whose surrounding lines touch into one excerpt. */
function excerpts(matches: SearchMatch[]) {
  const byFile = new Map<string, SearchMatch[]>();
  for (const m of matches) byFile.set(m.path, [...(byFile.get(m.path) ?? []), m]);
  const groups: { path: string; count: number; excerpts: number }[] = [];
  const all: Excerpt[] = [];
  const flat: SearchMatch[] = [];
  const excerptOf: number[] = []; // flat match → its excerpt
  for (const [path, ms] of byFile) {
    ms.sort((a, b) => a.line - b.line);
    const first = all.length;
    for (const m of ms) {
      const start = m.line - m.before.length;
      const lines = [...m.before, m.text, ...m.after];
      let ex = all.length > first ? all[all.length - 1] : undefined;
      if (ex && start <= ex.start + ex.lines.length) {
        const end = ex.start + ex.lines.length;
        ex.lines.push(...lines.slice(end - start));
      } else {
        ex = { path, start, lines, hits: new Map() };
        all.push(ex);
      }
      ex.hits.set(m.line, m.ranges);
      flat.push(m);
      excerptOf.push(all.length - 1);
    }
    groups.push({ path, count: ms.length, excerpts: all.length - first });
  }
  return { groups, all, flat, excerptOf };
}

/**
 * Marks every match in the rendered excerpts with the CSS Custom Highlight API, over the syntax
 * colours: no wrapper elements, so the highlighted HTML stays as Pierre made it.
 */
function paint(root: HTMLElement | null, all: Excerpt[], active: SearchMatch | undefined) {
  if (!root || typeof CSS === "undefined" || !("highlights" in CSS)) return;
  const hits: Range[] = [];
  const current: Range[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-excerpt]")) {
    const ex = all[Number(el.dataset.excerpt)];
    if (!ex) continue;
    const lines = el.querySelectorAll(".line");
    for (const [n, ranges] of ex.hits) {
      const line = lines[n - ex.start];
      if (!line) continue;
      const into = active?.path === ex.path && active.line === n ? current : hits;
      for (const [a, b] of ranges) {
        const r = rangeIn(line, a, b);
        if (r) into.push(r);
      }
    }
  }
  CSS.highlights.set("nit-search", new Highlight(...hits));
  CSS.highlights.set("nit-search-current", new Highlight(...current));
  return current[0];
}

/** Long lines scroll sideways: bring the current match into view inside its excerpt. */
function reveal(range: Range | undefined) {
  const pre = range?.startContainer.parentElement?.closest("pre");
  if (!range || !pre) return;
  const r = range.getBoundingClientRect();
  const box = pre.getBoundingClientRect();
  if (r.right > box.right - 24) pre.scrollLeft += r.right - box.right + box.width / 3;
  else if (r.left < box.left + 48) pre.scrollLeft = 0;
}

function Toggle({
  on,
  label,
  keys,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  keys: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <Tooltip label={label} keys={keys}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        onClick={onClick}
        className={`h-6 min-w-6 rounded-[6px] px-1.5 font-mono text-[11.5px] transition-[background-color,color] duration-100 ${
          on
            ? "bg-accent-tint text-accent-ink shadow-[inset_0_0_0_1px_var(--accent)]"
            : "text-ink-3 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Search across the whole repo as its own screen, like an editor's project search: every file
 * with matches, each match in a highlighted excerpt with the lines around it. ↑↓ move between
 * matches, Enter opens one (Back returns here), Esc leaves.
 */
export function SearchPane() {
  const search = st.useStore((s) => s.search);
  const files = st.useStore((s) => s.files);
  const key = keyOf(search);
  const [results, setResults] = useState<Results | null>(memo.results?.key === key ? memo.results : null);
  const [active, setActive] = useState(memo.results?.key === key ? memo.active : 0);
  const [loading, setLoading] = useState(false);
  const list = useRef<GroupedVirtuosoHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const inReview = useMemo(() => new Set(files.map((f) => f.name)), [files]);

  memo.results = results;
  memo.active = active;
  const set = (patch: Partial<st.State["search"]>) => st.set((s) => ({ search: { ...s.search, ...patch } }));

  // Live as you type, after a short pause; a newer search wins over a slower older one.
  useEffect(() => {
    const id = ++seq.current;
    if (!search.query.trim()) {
      setResults(null);
      return;
    }
    if (memo.results?.key === key) return; // already showing these
    setLoading(true);
    const t = setTimeout(() => {
      api.search(search.query, search.regex, search.caseSensitive).then(
        (r) => {
          if (id !== seq.current) return;
          setResults({ key, matches: r.matches, next: r.next, regexError: r.regexError });
          setActive(0);
          list.current?.scrollToIndex({ index: 0 });
          setLoading(false);
        },
        (e: unknown) => {
          if (id !== seq.current) return;
          // Say so: an empty screen would read as "nothing typed yet".
          setResults({ key, matches: [], next: null, error: e instanceof Error ? e.message : String(e) });
          setLoading(false);
        },
      );
    }, 120);
    return () => clearTimeout(t);
  }, [key, search.query, search.regex, search.caseSensitive]);

  const more = () => {
    const r = results;
    if (!r?.next || loading) return;
    const id = seq.current;
    setLoading(true);
    api.search(search.query, search.regex, search.caseSensitive, r.next).then(
      (page) => {
        if (id !== seq.current) return;
        setResults({ ...r, matches: [...r.matches, ...page.matches], next: page.next });
        setLoading(false);
      },
      () => id === seq.current && setLoading(false),
    );
  };

  const { groups, all, flat, excerptOf } = useMemo(() => excerpts(results?.matches ?? []), [results]);
  const current = flat[active];

  // Repaint when rows mount (scrolling, highlighting finishing) and when the current match moves.
  const latest = useRef({ all, current });
  latest.current = { all, current };
  useLayoutEffect(() => reveal(paint(scroller.current, all, current)), [all, current]);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint(root, latest.current.all, latest.current.current));
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      CSS.highlights?.delete("nit-search");
      CSS.highlights?.delete("nit-search-current");
    };
  }, []);

  // Back from a result: the list comes back where you left it, the current match centred.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    const i = excerptOf[active];
    if (i) requestAnimationFrame(() => list.current?.scrollToIndex({ index: i, align: "center" }));
  }, []);

  const openAt = (path: string, line: number) => {
    nav.openLocation({ path, line });
    st.set({ marking: true });
  };
  const at = useRef(active);
  at.current = active;
  const move = (d: number) => {
    if (!flat.length) return;
    const next = Math.min(flat.length - 1, Math.max(0, at.current + d));
    at.current = next; // key repeat can outrun renders
    setActive(next);
    list.current?.scrollIntoView({ index: excerptOf[next], behavior: "auto" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) move(1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) move(-1);
    else if (e.key === "PageDown") move(10);
    else if (e.key === "PageUp") move(-10);
    else if (e.key === "Enter" && current) openAt(current.path, current.line);
    else if (e.key === "Escape") nav.closeSearch();
    else if (mod && e.altKey && e.code === "KeyR") set({ regex: !search.regex });
    else if (mod && e.altKey && e.code === "KeyC") set({ caseSensitive: !search.caseSensitive });
    else if (mod && e.key === "f") input.current?.select();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /** Click picks the match on that line (or the excerpt's first); double-click opens the line. */
  const lineAt = (e: React.MouseEvent, ex: Excerpt) => {
    const line = (e.target as Element).closest(".line");
    const lines = line?.parentElement ? [...line.parentElement.children].filter((c) => c.matches(".line")) : [];
    return line ? ex.start + lines.indexOf(line) : null;
  };
  const pick = (exIndex: number, line: number | null) => {
    const onLine = flat.findIndex((m, i) => excerptOf[i] === exIndex && m.line === line);
    setActive(onLine !== -1 ? onLine : excerptOf.indexOf(exIndex));
  };

  const fileCount = groups.length;
  const summary =
    !results || results.error
      ? null
      : results.matches.length
        ? `${results.matches.length}${results.next ? "+" : ""} ${results.matches.length === 1 ? "result" : "results"} in ${fileCount}${results.next ? "+" : ""} ${fileCount === 1 ? "file" : "files"}`
        : "No results";

  return (
    <section
      aria-label="Search the repo"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-1 flex-col bg-page outline-none"
    >
      <header className="flex h-12 shrink-0 items-center gap-2.5 bg-surface px-4 shadow-[0_1px_0_var(--line)]">
        <DocMagnifyingGlass width={16} height={16} className="shrink-0 text-ink-3" />
        <input
          ref={input}
          // biome-ignore lint/a11y/noAutofocus: the screen exists to type into
          autoFocus
          value={search.query}
          onChange={(e) => set({ query: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Search the repo…  *.ts or src/ before the text narrows it"
          aria-label="Search text"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3"
        />
        {loading ? (
          <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-ink-2" />
        ) : null}
        <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">
          {summary && current && flat.length ? `${active + 1} of ${summary}` : summary}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Toggle
            on={search.caseSensitive}
            label="Match case"
            keys="Mod+Alt+c"
            onClick={() => set({ caseSensitive: !search.caseSensitive })}
          >
            Aa
          </Toggle>
          <Toggle
            on={search.regex}
            label="Regular expression"
            keys="Mod+Alt+r"
            onClick={() => set({ regex: !search.regex })}
          >
            .*
          </Toggle>
        </span>
        <IconButton label="Close search" keys="Esc" onClick={nav.closeSearch}>
          <Xmark />
        </IconButton>
      </header>

      {results?.regexError ? (
        <p className="shrink-0 bg-orange-tint px-4 py-1.5 text-[12px] text-ink-2">
          Not a valid regex, so this is a plain-text search: {results.regexError}
        </p>
      ) : null}

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col">
        {groups.length ? (
          <GroupedVirtuoso
            ref={list}
            className="min-h-0 flex-1"
            groupCounts={groups.map((g) => g.excerpts)}
            endReached={more}
            increaseViewportBy={400}
            groupContent={(gi) => {
              const g = groups[gi];
              return (
                <div className="flex h-9 items-center gap-1.5 bg-surface px-4 shadow-[0_1px_0_var(--line),0_-1px_0_var(--line)]">
                  <button
                    type="button"
                    onClick={() => openAt(g.path, all.find((x) => x.path === g.path)?.start ?? 1)}
                    className="flex min-w-0 items-baseline gap-1.5 text-left [@media(hover:hover)]:hover:[&>span:first-child]:underline"
                  >
                    <span className="shrink-0 text-[12.5px] font-medium text-ink">{basename(g.path)}</span>
                    <span className="min-w-0 truncate text-[12px] text-ink-3">
                      {dirname(g.path).replace(/\/$/, "")}
                    </span>
                  </button>
                  {inReview.has(g.path) ? (
                    <span className="shrink-0 rounded-chip bg-orange-tint px-1.5 py-px text-[11px] text-orange">
                      in review
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[11.5px] text-ink-3 tabular-nums">
                    {g.count} {g.count === 1 ? "match" : "matches"}
                  </span>
                </div>
              );
            }}
            itemContent={(i) => {
              const ex = all[i];
              const continued = i > 0 && all[i - 1].path === ex.path;
              const here = current && excerptOf[active] === i ? current.line : undefined;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the screen owns the keyboard (arrows + Enter)
                <div
                  data-excerpt={i}
                  onClick={(e) => pick(i, lineAt(e, ex))}
                  onDoubleClick={(e) => openAt(ex.path, lineAt(e, ex) ?? ex.start)}
                  className="cursor-default px-2 text-[12.5px] [&_pre]:!bg-transparent [&_pre]:overflow-x-auto [&_pre]:py-1 [&_pre]:[scrollbar-width:none]"
                >
                  {continued ? (
                    <div aria-hidden className="mx-2 flex h-4 items-center">
                      <span className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--line)_0_4px,transparent_4px_8px)]" />
                    </div>
                  ) : null}
                  <CodeBlock source={ex.lines.join("\n")} lang={langFor(ex.path)} startLine={ex.start} mark={here} />
                </div>
              );
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-8 text-center">
            <span className="text-ink-2">
              {results?.error ? "Search failed" : results ? "No results" : "Search every file in the repo"}
            </span>
            <span className="text-[12px] text-ink-3">
              {results?.error
                ? results.error === "not found"
                  ? "This nit server is older than the page. Restart nit."
                  : results.error
                : results
                  ? "Try fewer words, or turn off match case."
                  : "Start with *.tsx or apps/erp/ to narrow it."}
            </span>
          </div>
        )}
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-3 bg-surface px-4 text-[11.5px] text-ink-3 shadow-[0_-1px_0_var(--line)]">
        <span className="flex items-center gap-1">
          <Kbd k="ArrowUp" quiet /> <Kbd k="ArrowDown" quiet /> Next match
        </span>
        <span className="flex items-center gap-1">
          <Kbd k="Enter" quiet /> Open
        </span>
        <span className="flex items-center gap-1">
          <Kbd k="Mod+[" quiet /> Back to results
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd k="Esc" quiet /> Close
        </span>
      </footer>
    </section>
  );
}
