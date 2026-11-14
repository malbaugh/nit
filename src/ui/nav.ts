import type { FileDiffMetadata } from "@pierre/diffs";
import type { Location, Side, Symbol as Sym } from "../types";
import { api } from "./api";
import { rows } from "./lines";
import * as st from "./state";

// ---------- back stack (⌘[)

const history: { file: string; cursor: st.Point | null }[] = [];

function remember() {
  const f = st.currentFile();
  if (!f) return;
  history.push({ file: f.name, cursor: st.get().cursor });
  if (history.length > 100) history.shift();
}

export function goBack() {
  const h = history.pop();
  if (!h) return;
  const i = st.get().files.findIndex((f) => f.name === h.file);
  if (i === -1) return;
  if (i !== st.get().current) st.openFile(i);
  st.set({ cursor: h.cursor, anchor: null, peek: null });
}

// ---------- outlines

const pending = new Map<string, Promise<void>>();

/** Fetches a file's symbols once per file version (the store clears them on reload). */
export function loadOutline(file: FileDiffMetadata) {
  if (st.get().outlines[file.name] || pending.has(file.name)) return;
  const p = api
    .symbols(file.name, file.prevName)
    .then((o) => st.set((s) => ({ outlines: { ...s.outlines, [file.name]: o } })))
    .catch(() => st.set((s) => ({ outlines: { ...s.outlines, [file.name]: { new: null, old: null } } })))
    .finally(() => pending.delete(file.name));
  pending.set(file.name, p);
}

/** Symbols that contain a line, outermost first. */
export function enclosing(symbols: Sym[] | null | undefined, line: number) {
  return (symbols ?? [])
    .filter((s) => s.line <= line && line <= s.endLine)
    .sort((a, b) => a.line - b.line || b.endLine - a.endLine);
}

// ---------- lookups

const pathFor = (file: FileDiffMetadata, side: Side) =>
  side === "deletions" ? (file.prevName ?? file.name) : file.name;

/**
 * Go to definition / find references from the cursor line. With several words on the line a
 * picker opens first; ⌘-click passes the clicked column instead.
 */
export async function lookup(mode: "definition" | "references", by?: { name: string } | { col: number }) {
  const file = st.currentFile();
  const cursor = st.get().cursor;
  if (!file || !cursor) return;
  const at = { path: pathFor(file, cursor.side), side: cursor.side, line: cursor.line };
  const base = { at: cursor, path: at.path };

  let target = by;
  if (!target || ("col" in target && mode === "references")) {
    st.set({ peek: { ...base, kind: "pick", mode, identifiers: [], status: "loading" } });
    try {
      const ids = await api.identifiers(at);
      const col = target && "col" in target ? target.col : null;
      const hit = col === null ? null : ids.find((i) => col >= i.col && col < i.col + i.name.length);
      if (hit) target = { name: hit.name };
      else if (ids.length === 1) target = { name: ids[0].name };
      else if (!ids.length)
        return st.set({
          peek: { ...base, kind: "pick", mode, identifiers: [], status: "error", error: "No symbol on this line." },
        });
      else return st.set({ peek: { ...base, kind: "pick", mode, identifiers: ids, status: "ready" } });
    } catch (e) {
      return st.set({ peek: { ...base, kind: "pick", mode, identifiers: [], status: "error", error: String(e) } });
    }
  }

  try {
    if (mode === "definition") {
      st.set({
        peek: {
          ...base,
          kind: "definition",
          name: "name" in target ? target.name : null,
          results: [],
          status: "loading",
        },
      });
      const r = await api.definition(at, target);
      st.set({ peek: { ...base, kind: "definition", name: r.name, results: r.results, status: "ready" } });
    } else {
      const name = (target as { name: string }).name;
      st.set({
        peek: {
          ...base,
          kind: "references",
          name,
          changed: [],
          untouched: [],
          text: [],
          truncated: false,
          status: "loading",
        },
      });
      const r = await api.references(name);
      st.set({ peek: { ...base, kind: "references", ...r, status: "ready" } });
    }
  } catch (e) {
    st.set((s) =>
      s.peek ? { peek: { ...s.peek, status: "error", error: e instanceof Error ? e.message : String(e) } } : {},
    );
  }
}

export const closePeek = () => st.set({ peek: null });

/** Moves to a location when its file is in this review. Returns false when it isn't. */
export function openLocation(loc: Location) {
  const files = st.get().files;
  const index = files.findIndex((f) => f.name === loc.path);
  if (index === -1) return false;
  remember();
  if (index !== st.get().current) st.openFile(index);
  const r = rows(files[index]);
  const exact = r.find((x) => x.side === "additions" && x.line === loc.line);
  const near = exact ?? r.find((x) => x.side === "additions" && x.line >= loc.line) ?? r.at(-1);
  st.set({ cursor: near ? { side: near.side, line: near.line } : null, anchor: null, peek: null, focused: null });
  return !!exact;
}

/** Outline click: move to the symbol when it's in the diff, otherwise show its code in a peek. */
export async function revealSymbol(sym: Sym, side: Side) {
  const file = st.currentFile();
  if (!file) return;
  const r = rows(file);
  const row = r.find((x) => x.side === side && x.line >= sym.line && x.line <= sym.endLine);
  if (row) {
    remember();
    st.set({ cursor: { side: row.side, line: row.line }, anchor: null, peek: null });
    return;
  }
  const text = await st.fileContents(file).catch(() => null);
  const source = (side === "additions" ? text?.new : text?.old) ?? "";
  const lines = source.split("\n");
  const end = Math.min(sym.endLine, sym.line + 14);
  const loc: Location = {
    path: pathFor(file, side),
    line: sym.nameLine,
    col: sym.nameCol,
    text: (lines[sym.nameLine - 1] ?? "").trim(),
    kind: sym.kind,
    snippet: lines.slice(sym.line - 1, end).join("\n"),
    snippetStart: sym.line,
    inDiff: true,
    changed: false,
  };
  // Shown above the first change: the symbol itself is outside every hunk.
  st.set({
    peek: { at: { side, line: 0 }, path: loc.path, kind: "symbol", name: sym.name, results: [loc], status: "ready" },
  });
}
