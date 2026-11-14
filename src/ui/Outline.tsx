import { useEffect, useMemo, useState } from "react";
import type { Side, Symbol as Sym } from "../types";
import { changedLines } from "./lines";
import * as nav from "./nav";
import * as st from "./state";
import { Kbd, TextSegmented } from "./ui";

/** One letter per kind, coloured quietly so the names stay the focus. */
const KIND: Record<string, { letter: string; tone: string }> = {
  function: { letter: "ƒ", tone: "text-[oklch(0.72_0.12_300)]" },
  method: { letter: "m", tone: "text-[oklch(0.72_0.12_300)]" },
  class: { letter: "C", tone: "text-orange" },
  interface: { letter: "I", tone: "text-accent-ink" },
  type: { letter: "T", tone: "text-accent-ink" },
  module: { letter: "M", tone: "text-ink-2" },
  constant: { letter: "c", tone: "text-green" },
  macro: { letter: "#", tone: "text-ink-2" },
  enum: { letter: "E", tone: "text-orange" },
  variable: { letter: "v", tone: "text-green" },
  field: { letter: "f", tone: "text-ink-2" },
  suite: { letter: "D", tone: "text-accent-ink" },
  test: { letter: "t", tone: "text-green" },
};
const kindOf = (k: string) => KIND[k] ?? { letter: k.slice(0, 1), tone: "text-ink-3" };

type Entry = Sym & { depth: number; status: "added" | "changed" | null };

const key = (s: Sym) => `${s.kind}:${s.name}`;

/** Old symbols whose span holds a removed line: they changed even if no line was added. */
function touchedOld(old: Sym[], removed: Set<number>) {
  const keys = new Set<string>();
  for (const s of old)
    for (let l = s.line; l <= s.endLine; l++)
      if (removed.has(l)) {
        keys.add(key(s));
        break;
      }
  return keys;
}

/**
 * Nesting by containment, plus what the diff did to each symbol: `added` if it didn't exist
 * before, `changed` if an added line falls in it or a removed line fell in its old version.
 */
function entries(symbols: Sym[], old: Sym[] | null, added: Set<number>, removed: Set<number>): Entry[] {
  const before = old ? new Set(old.map(key)) : null;
  const touched = old ? touchedOld(old, removed) : new Set<string>();
  const stack: Sym[] = [];
  return symbols.map((s) => {
    while (stack.length && stack[stack.length - 1].endLine < s.line) stack.pop();
    const depth = stack.length;
    stack.push(s);
    let hit = false;
    for (let l = s.line; l <= s.endLine && !hit; l++) hit = added.has(l);
    const status = before && !before.has(key(s)) ? "added" : hit || touched.has(key(s)) ? "changed" : null;
    return { ...s, depth, status };
  });
}

export function OutlinePanel() {
  const file = st.useStore((s) => st.currentFile(s));
  const outline = st.useStore((s) => (file ? s.outlines[file.name] : undefined));
  const cursor = st.useStore((s) => s.cursor);
  const [onlyChanged, setOnlyChanged] = useState(false);

  useEffect(() => {
    if (file) nav.loadOutline(file);
  }, [file]);

  const view = useMemo(() => {
    if (!file || !outline) return null;
    const { added, removed: gone } = changedLines(file);
    const all = entries(outline.new ?? [], file.type === "new" ? [] : outline.old, added, gone);
    const present = new Set((outline.new ?? []).map(key));
    const removed = (outline.old ?? []).filter((s) => !present.has(key(s)));
    return { all, removed, changedCount: all.filter((e) => e.status).length };
  }, [file, outline]);

  const here = cursor?.side === "additions" ? nav.enclosing(outline?.new, cursor.line).at(-1) : undefined;
  const rows = view ? (onlyChanged ? view.all.filter((e) => e.status) : view.all) : [];

  return (
    <aside
      className="flex min-h-0 w-[248px] shrink-0 flex-col bg-canvas shadow-[-1px_0_0_var(--line)]"
      aria-label="Outline"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-3.5">
        <span className="text-[13px] font-medium text-ink">Outline</span>
        {view ? <span className="text-[12px] text-ink-3 tabular-nums">{view.all.length}</span> : null}
        <span className="ml-auto">
          <Kbd k="O" quiet />
        </span>
      </header>
      <div className="flex h-7 shrink-0 items-center gap-1 px-2.5">
        <TextSegmented
          label="Which symbols"
          value={onlyChanged ? "changed" : "all"}
          onChange={(v) => setOnlyChanged(v === "changed")}
          options={[
            { value: "all", label: "All" },
            {
              value: "changed",
              label: (
                <>Changed{view ? <span className="ml-1 text-ink-3 tabular-nums">{view.changedCount}</span> : null}</>
              ),
            },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {!outline ? <p className="px-2 py-2 text-[12px] text-ink-3">Reading symbols…</p> : null}
        {outline && !outline.new && !outline.old ? (
          <p className="px-2 py-2 text-[12px] leading-relaxed text-ink-3">No outline for this file type yet.</p>
        ) : null}
        {rows.map((e) => (
          <SymbolRow
            key={`${e.line}:${e.name}`}
            entry={e}
            active={here === e || (here?.line === e.line && here.name === e.name)}
            side="additions"
          />
        ))}
        {view && onlyChanged && !rows.length ? (
          <p className="px-2 py-2 text-[12px] text-ink-3">No symbols changed in this file.</p>
        ) : null}
        {view?.removed.length ? (
          <>
            <div className="px-2 pt-3 pb-1 text-[11.5px] font-medium text-ink-3">Removed</div>
            {view.removed.map((s) => (
              <SymbolRow
                key={`old:${s.line}:${s.name}`}
                entry={{ ...s, depth: 0, status: null }}
                removed
                side="deletions"
              />
            ))}
          </>
        ) : null}
      </div>
    </aside>
  );
}

function SymbolRow({
  entry,
  active = false,
  removed = false,
  side,
}: {
  entry: Entry;
  active?: boolean;
  removed?: boolean;
  side: Side;
}) {
  const k = kindOf(entry.kind);
  return (
    <button
      type="button"
      onClick={() => void nav.revealSymbol(entry, side)}
      title={`${entry.kind} ${entry.name}, lines ${entry.line}–${entry.endLine}`}
      className={`flex h-7 w-full min-w-0 items-center gap-2 rounded-control pr-2 text-left transition-[background-color] duration-100 [@media(hover:hover)]:hover:bg-hover ${
        active ? "bg-hover-2" : ""
      }`}
      style={{ paddingLeft: 8 + Math.min(entry.depth, 6) * 12 }}
    >
      <span
        className={`w-3 shrink-0 text-center font-mono text-[11.5px] font-semibold ${removed ? "text-red" : k.tone}`}
      >
        {k.letter}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[12.5px] ${removed ? "text-ink-3 line-through decoration-red/60" : active ? "text-ink" : "text-ink-2"}`}
      >
        {entry.name}
      </span>
      {entry.status ? (
        <span
          className={`size-1.5 shrink-0 rounded-full ${entry.status === "added" ? "bg-green" : "bg-orange"}`}
          title={entry.status === "added" ? "Added in this diff" : "Changed in this diff"}
        />
      ) : null}
    </button>
  );
}
