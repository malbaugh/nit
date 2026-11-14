import { Dialog } from "@base-ui/react/dialog";
import { DocMagnifyingGlass } from "iconoir-react/regular";
import { useEffect, useMemo, useRef, useState } from "react";
import { GroupedVirtuoso, type GroupedVirtuosoHandle } from "react-virtuoso";
import type { SearchMatch } from "../types";
import { api } from "./api";
import { CodeBlock, langFor } from "./Code";
import { textOf } from "./FilePane";
import * as nav from "./nav";
import * as st from "./state";
import { basename, dirname, Kbd, Tooltip } from "./ui";

// The last search comes back when the window reopens, as in editors.
const last = { query: "", regex: false, caseSensitive: false };

type Results = { query: string; matches: SearchMatch[]; next: string | null; regexError?: string; error?: string };

/** A match's line with its hits marked; leading indentation is dropped. */
function Line({ m }: { m: SearchMatch }) {
  const indent = m.text.length - m.text.trimStart().length;
  const text = m.text.slice(indent);
  const parts: { t: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a0, b0] of m.ranges) {
    const a = Math.max(0, a0 - indent);
    const b = Math.max(a, b0 - indent);
    if (a > at) parts.push({ t: text.slice(at, a), hit: false });
    parts.push({ t: text.slice(a, b), hit: true });
    at = b;
  }
  parts.push({ t: text.slice(at), hit: false });
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
      {parts.map((p, i) =>
        p.hit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line
          <mark key={i} className="rounded-[3px] bg-orange-tint text-ink shadow-[0_0_0_1px_var(--orange-tint)]">
            {p.t}
          </mark>
        ) : (
          p.t
        ),
      )}
    </span>
  );
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

/** Code around the selected match, highlighted, its line marked. */
function Preview({ m }: { m: SearchMatch | undefined }) {
  const [text, setText] = useState<{ path: string; contents: string | null } | null>(null);
  const path = m?.path;
  useEffect(() => {
    if (!path) return;
    let alive = true;
    textOf(path).then(
      (contents) => alive && setText({ path, contents }),
      () => alive && setText({ path, contents: null }),
    );
    return () => {
      alive = false;
    };
  }, [path]);
  if (!m) return <div className="flex-1" />;
  const lines = text?.path === m.path && text.contents !== null ? text.contents.split("\n") : null;
  const from = Math.max(1, m.line - 12);
  const to = lines ? Math.min(lines.length, m.line + 24) : m.line;
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-page px-1 py-2 text-[12px] [&_pre]:!bg-transparent">
      {lines ? (
        <CodeBlock
          source={lines.slice(from - 1, to).join("\n")}
          lang={langFor(m.path)}
          startLine={from}
          mark={m.line}
        />
      ) : (
        <p className="px-3 py-2 text-ink-3">Reading…</p>
      )}
    </div>
  );
}

/**
 * Search across the whole repo (fff, recently used files first), grouped by file with sticky
 * headers. ↑↓ move, Enter opens: in the diff when the file is in the review, read-only when not.
 */
export function SearchWindow() {
  const open = st.useStore((s) => s.searchOpen);
  if (!open) return null;
  return <SearchDialog />;
}

function SearchDialog() {
  const files = st.useStore((s) => s.files);
  const [query, setQuery] = useState(last.query);
  const [regex, setRegex] = useState(last.regex);
  const [caseSensitive, setCase] = useState(last.caseSensitive);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<GroupedVirtuosoHandle>(null);
  const seq = useRef(0);
  const inReview = useMemo(() => new Set(files.map((f) => f.name)), [files]);

  Object.assign(last, { query, regex, caseSensitive });

  // Live as you type, after a short pause; a newer search wins over a slower older one.
  useEffect(() => {
    const id = ++seq.current;
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api.search(query, regex, caseSensitive).then(
        (r) => {
          if (id !== seq.current) return;
          setResults({ query, matches: r.matches, next: r.next, regexError: r.regexError });
          setActive(0);
          list.current?.scrollToIndex({ index: 0 });
          setLoading(false);
        },
        (e: unknown) => {
          if (id !== seq.current) return;
          // Say so: an empty prompt would read as "nothing typed yet".
          setResults({ query, matches: [], next: null, error: e instanceof Error ? e.message : String(e) });
          setLoading(false);
        },
      );
    }, 120);
    return () => clearTimeout(t);
  }, [query, regex, caseSensitive]);

  const more = () => {
    const r = results;
    if (!r?.next || loading) return;
    const id = seq.current;
    setLoading(true);
    api.search(r.query, regex, caseSensitive, r.next).then(
      (page) => {
        if (id !== seq.current) return;
        setResults({ ...r, matches: [...r.matches, ...page.matches], next: page.next });
        setLoading(false);
      },
      () => id === seq.current && setLoading(false),
    );
  };

  // Matches arrive file by file; keep them grouped in first-seen order.
  const groups = useMemo(() => {
    const out: { path: string; matches: SearchMatch[] }[] = [];
    const at = new Map<string, number>();
    for (const m of results?.matches ?? []) {
      let i = at.get(m.path);
      if (i === undefined) {
        i = out.push({ path: m.path, matches: [] }) - 1;
        at.set(m.path, i);
      }
      out[i].matches.push(m);
    }
    return out;
  }, [results]);
  const flat = useMemo(() => groups.flatMap((g) => g.matches), [groups]);
  const current = flat[active];

  const close = () => st.set({ searchOpen: false });
  const openMatch = (m: SearchMatch | undefined) => {
    if (!m) return;
    close();
    nav.openLocation({ path: m.path, line: m.line });
  };
  const move = (d: number) => {
    if (!flat.length) return;
    const next = Math.min(flat.length - 1, Math.max(0, active + d));
    setActive(next);
    list.current?.scrollIntoView({ index: next, behavior: "auto" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) move(1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) move(-1);
    else if (e.key === "PageDown") move(10);
    else if (e.key === "PageUp") move(-10);
    else if (e.key === "Enter") openMatch(current);
    else if (mod && e.altKey && e.code === "KeyR") setRegex((v) => !v);
    else if (mod && e.altKey && e.code === "KeyC") setCase((v) => !v);
    else return;
    e.preventDefault();
  };

  const fileCount = groups.length;
  const summary =
    !results || results.error
      ? null
      : results.matches.length
        ? `${results.matches.length}${results.next ? "+" : ""} results in ${fileCount}${results.next ? "+" : ""} ${fileCount === 1 ? "file" : "files"}`
        : "No results";

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.28)]" />
        <Dialog.Popup
          aria-label="Search the repo"
          onKeyDown={onKeyDown}
          className="fixed top-[8vh] left-1/2 z-50 flex h-[76vh] w-[min(1080px,calc(100vw-48px))] -translate-x-1/2 flex-col overflow-hidden rounded-window bg-surface shadow-overlay outline-none"
        >
          <div className="flex h-12 shrink-0 items-center gap-2.5 px-4 shadow-[0_1px_0_var(--line)]">
            <DocMagnifyingGlass width={16} height={16} className="shrink-0 text-ink-3" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the window exists to type into
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Search the repo…  *.ts or src/ before the text narrows it"
              aria-label="Search text"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3"
            />
            {loading ? (
              <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-ink-2" />
            ) : null}
            <Toggle on={caseSensitive} label="Match case" keys="Mod+Alt+c" onClick={() => setCase((v) => !v)}>
              Aa
            </Toggle>
            <Toggle on={regex} label="Regular expression" keys="Mod+Alt+r" onClick={() => setRegex((v) => !v)}>
              .*
            </Toggle>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 w-[46%] min-w-[320px] flex-col shadow-[1px_0_0_var(--line)]">
              {results?.regexError ? (
                <p className="shrink-0 bg-orange-tint px-4 py-1.5 text-[12px] text-ink-2">
                  Not a valid regex, so this is a plain-text search: {results.regexError}
                </p>
              ) : null}
              {groups.length ? (
                <GroupedVirtuoso
                  ref={list}
                  className="min-h-0 flex-1"
                  groupCounts={groups.map((g) => g.matches.length)}
                  endReached={more}
                  increaseViewportBy={200}
                  groupContent={(gi) => {
                    const g = groups[gi];
                    return (
                      <div className="flex h-8 items-center gap-1.5 bg-surface px-4 shadow-[0_1px_0_var(--line-soft)]">
                        <span className="shrink-0 text-[12.5px] font-medium text-ink">{basename(g.path)}</span>
                        <span className="min-w-0 truncate text-[12px] text-ink-3">
                          {dirname(g.path).replace(/\/$/, "")}
                        </span>
                        {inReview.has(g.path) ? (
                          <span className="shrink-0 rounded-chip bg-orange-tint px-1.5 py-px text-[11px] text-orange">
                            in review
                          </span>
                        ) : null}
                        <span className="ml-auto shrink-0 text-[11.5px] text-ink-3 tabular-nums">
                          {g.matches.length}
                        </span>
                      </div>
                    );
                  }}
                  itemContent={(i) => {
                    const m = flat[i];
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the window owns the keyboard (arrows + Enter)
                      <div
                        role="option"
                        aria-selected={i === active}
                        tabIndex={-1}
                        onClick={() => setActive(i)}
                        onDoubleClick={() => openMatch(m)}
                        className={`mx-1.5 flex h-7 cursor-default items-center gap-2.5 rounded-control pr-2 pl-2.5 ${
                          i === active ? "bg-hover-2" : "[@media(hover:hover)]:hover:bg-hover"
                        }`}
                      >
                        <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ink-3 tabular-nums">
                          {m.line}
                        </span>
                        <Line m={m} />
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
            <Preview m={current} />
          </div>

          <footer className="flex h-9 shrink-0 items-center gap-3 bg-inset px-4 text-[11.5px] text-ink-3 shadow-[0_-1px_0_var(--line)]">
            <span className="tabular-nums">{summary}</span>
            <span className="ml-auto flex items-center gap-1">
              <Kbd k="ArrowUp" quiet /> <Kbd k="ArrowDown" quiet /> Move
            </span>
            <span className="flex items-center gap-1">
              <Kbd k="Enter" quiet /> Open
            </span>
            <span className="flex items-center gap-1">
              <Kbd k="Esc" quiet /> Close
            </span>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
