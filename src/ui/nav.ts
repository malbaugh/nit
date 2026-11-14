import type { FileDiffMetadata } from "@pierre/diffs";
import type { Side, Symbol as Sym } from "../types";
import { api } from "./api";
import { rows } from "./lines";
import * as st from "./state";

// ---------- back stack (⌘[)

type Place = { file: string; cursor: st.Point | null } | { browse: st.Browse };
const history: Place[] = [];

function remember() {
  const { browse } = st.get();
  const f = st.currentFile();
  if (browse) history.push({ browse });
  else if (f) history.push({ file: f.name, cursor: st.get().cursor });
  else return;
  if (history.length > 100) history.shift();
}

export function goBack() {
  const h = history.pop();
  if (!h) return void (st.get().browse && st.set({ browse: null, peek: null }));
  if ("browse" in h) return st.set({ browse: h.browse, peek: null });
  const i = st.get().files.findIndex((f) => f.name === h.file);
  if (i === -1) return;
  st.openFile(i);
  st.set({ cursor: h.cursor, anchor: null, peek: null, browse: null });
}

// ---------- outlines

const pending = new Map<string, Promise<void>>();

/** Fetches a file's symbols once per file version (the store clears them on reload). */
export function loadOutline(path: string, prevName?: string) {
  if (st.get().outlines[path] || pending.has(path)) return;
  const p = api
    .symbols(path, prevName)
    .then((o) => st.set((s) => ({ outlines: { ...s.outlines, [path]: o } })))
    .catch(() => st.set((s) => ({ outlines: { ...s.outlines, [path]: { new: null, old: null } } })))
    .finally(() => pending.delete(path));
  pending.set(path, p);
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
  const { browse } = st.get();
  // In a file outside the review the cursor is the browse line, always on the working copy.
  const cursor: st.Point | null = browse ? { side: "additions", line: browse.line } : st.get().cursor;
  if (!cursor || (!file && !browse)) return;
  const path = browse ? browse.path : pathFor(file as FileDiffMetadata, cursor.side);
  const at = { path, side: cursor.side, line: cursor.line };
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
      // Like an editor: one definition is a jump, not a card (read-only when it's outside
      // the review). The loading card
      // only shows if the lookup is slow, so a jump doesn't flash one.
      const name = "name" in target ? target.name : null;
      const slow = setTimeout(
        () => st.set({ peek: { ...base, kind: "definition", name, results: [], status: "loading" } }),
        150,
      );
      const r = await api.definition(at, target).finally(() => clearTimeout(slow));
      if (r.results.length === 1) return openLocation(r.results[0]);
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

/** Puts the cursor on a line of a file in this review, showing the whole file if the line is folded away. */
async function goToLine(index: number, side: Side, line: number) {
  const files = st.get().files;
  remember();
  st.openFile(index); // also leaves a file opened outside the review
  const path = files[index].name;
  const visible = rows(st.get().files[index], st.get().fullFiles.has(path)).some(
    (x) => x.side === side && x.line === line,
  );
  if (!visible && side === "additions") await st.setFullFile(path, true);
  st.set({ cursor: { side, line }, anchor: null, peek: null, focused: null });
}

/** Moves to a location: in the review's diff when the file is part of it, else read-only. */
export function openLocation(loc: { path: string; line: number }) {
  const index = st.get().files.findIndex((f) => f.name === loc.path);
  if (index !== -1) return void goToLine(index, "additions", loc.line);
  remember();
  st.set({ browse: { path: loc.path, line: loc.line, lines: 0 }, peek: null, anchor: null, focused: null });
}

/** Outline click: go to the symbol in the code, unfolding the file if it's outside the changes. */
export async function revealSymbol(sym: Sym, side: Side) {
  const { browse } = st.get();
  if (browse) return st.set({ browse: { ...browse, line: sym.nameLine } });
  const index = st.get().current;
  if (st.get().files[index]) await goToLine(index, side, sym.nameLine);
}
