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
      // Like an editor: one definition in this review is a jump, not a card. The loading card
      // only shows if the lookup is slow, so a jump doesn't flash one.
      const name = "name" in target ? target.name : null;
      const slow = setTimeout(
        () => st.set({ peek: { ...base, kind: "definition", name, results: [], status: "loading" } }),
        150,
      );
      const r = await api.definition(at, target).finally(() => clearTimeout(slow));
      if (r.results.length === 1 && openLocation(r.results[0])) return;
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
  if (index !== st.get().current) st.openFile(index);
  const path = files[index].name;
  const visible = rows(st.get().files[index], st.get().fullFiles.has(path)).some(
    (x) => x.side === side && x.line === line,
  );
  if (!visible && side === "additions") await st.setFullFile(path, true);
  st.set({ cursor: { side, line }, anchor: null, peek: null, focused: null });
}

/** Moves to a location when its file is in this review. Returns false when it isn't. */
export function openLocation(loc: Location) {
  const index = st.get().files.findIndex((f) => f.name === loc.path);
  if (index === -1) return false;
  void goToLine(index, "additions", loc.line);
  return true;
}

/** Outline click: go to the symbol in the code, unfolding the file if it's outside the changes. */
export async function revealSymbol(sym: Sym, side: Side) {
  const index = st.get().current;
  if (st.get().files[index]) await goToLine(index, side, sym.nameLine);
}
