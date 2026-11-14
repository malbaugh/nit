import { type FileDiffMetadata, hydratePartialDiff, parsePatchFiles } from "@pierre/diffs";
import { useSyncExternalStore } from "react";
import type { Draft, FileContents, ReviewData, Side } from "../types";
import { api } from "./api";
import { type Row, rows } from "./lines";

export type Point = { side: Side; line: number };
export type Style = "split" | "unified";

type State = {
  data: ReviewData | null;
  error: string | null;
  files: FileDiffMetadata[];
  current: number;
  style: Style;
  sidebar: boolean;
  viewed: Set<string>;
  drafts: Draft[];
  /** Where the line cursor is, and where a range started (shift + arrows). */
  cursor: Point | null;
  anchor: Point | null;
  editing: string | null;
  focused: string | null;
  saving: Record<string, "saving" | "error">;
  palette: "all" | "files" | null;
  toast: { message: string; undo?: () => void } | null;
};

const storedStyle = (): Style => {
  try {
    return localStorage.getItem("nit.style") === "unified" ? "unified" : "split";
  } catch {
    return "split";
  }
};

let state: State = {
  data: null,
  error: null,
  files: [],
  current: 0,
  style: storedStyle(),
  sidebar: true,
  viewed: new Set(),
  drafts: [],
  cursor: null,
  anchor: null,
  editing: null,
  focused: null,
  saving: {},
  palette: null,
  toast: null,
};

const listeners = new Set<() => void>();
export const get = () => state;
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useStore = <T>(select: (s: State) => T): T => useSyncExternalStore(subscribe, () => select(state));

export const currentFile = (s = state) => s.files[s.current];

// ---------- file contents (full old/new text, for context expansion and comment anchors)

const contents = new Map<string, Promise<FileContents>>();
export function fileContents(file: FileDiffMetadata) {
  const key = `${file.prevName ?? ""}>${file.name}`;
  let p = contents.get(key);
  if (!p) {
    p = api.file(file.name, file.prevName);
    p.catch(() => contents.delete(key));
    contents.set(key, p);
  }
  return p;
}

/** Swaps a parsed patch for one that also carries both files' full text, so unchanged lines can expand. */
export async function hydrate(index: number) {
  const file = state.files[index];
  if (!file?.isPartial) return;
  try {
    const c = await fileContents(file);
    const newFile = { name: file.name, contents: c.new ?? "" };
    const full = hydratePartialDiff(
      "clone",
      file,
      c.old === null
        ? { oldFile: null, newFile }
        : { oldFile: { name: file.prevName ?? file.name, contents: c.old }, newFile },
    );
    set((s) => (s.files[index] === file ? { files: s.files.map((f, i) => (i === index ? full : f)) } : {}));
  } catch {
    // The patch alone still renders; only context expansion is lost.
  }
}

const hydrateAround = (i: number) => {
  void hydrate(i);
  void hydrate(i + 1);
};

// ---------- loading

export async function load() {
  try {
    const requested = Date.now();
    const data = await api.review();
    contents.clear();
    const files = parsePatchFiles(data.patch).flatMap((p) => p.files);
    const before = currentFile()?.name;
    set((s) => {
      const current = Math.max(0, before ? files.findIndex((f) => f.name === before) : 0);
      // The newer copy of each draft wins. A local draft the server doesn't list is kept if it
      // is unsaved, open, or changed after this request started (the response may predate its save).
      const listed = data.drafts.filter((d) => !deleted.has(d.id)); // deletions still in flight
      const server = new Map(listed.map((d) => [d.id, d]));
      const local = new Map(s.drafts.map((d) => [d.id, d]));
      const drafts = [
        ...listed.map((d) => {
          const mine = local.get(d.id);
          return mine && (unsaved.has(d.id) || mine.updatedAt > d.updatedAt) ? mine : d;
        }),
        ...s.drafts.filter(
          (d) => !server.has(d.id) && (unsaved.has(d.id) || d.id === s.editing || d.updatedAt >= requested),
        ),
      ];
      return {
        data,
        files,
        current,
        drafts,
        viewed: new Set(data.viewed),
        error: null,
      };
    });
    const r = fileRows();
    if (currentFile()?.name !== before || rowIndex(r, state.cursor) === -1) resetCursor();
    hydrateAround(state.current);
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ---------- navigation

const fileRows = (s = state): Row[] => {
  const f = currentFile(s);
  return f ? rows(f) : [];
};

function resetCursor() {
  const r = fileRows();
  const first = r.find((x) => x.changeStart) ?? r[0];
  set({
    cursor: first ? { side: first.side, line: first.line } : null,
    anchor: null,
    editing: null,
  });
}

export function openFile(index: number) {
  if (index < 0 || index >= state.files.length || index === state.current) return;
  set({ current: index, focused: null });
  resetCursor();
  hydrateAround(index);
}

const rowIndex = (r: Row[], p: Point | null) => (p ? r.findIndex((x) => x.side === p.side && x.line === p.line) : -1);

export function moveCursor(delta: number, extend = false) {
  const r = fileRows();
  if (!r.length) return;
  const i = Math.min(r.length - 1, Math.max(0, rowIndex(r, state.cursor) + delta));
  const next = { side: r[i].side, line: r[i].line };
  set((s) => ({
    cursor: next,
    anchor: extend ? (s.anchor ?? s.cursor) : null,
    focused: null,
  }));
}

export function nextChange(direction: 1 | -1) {
  const r = fileRows();
  const at = rowIndex(r, state.cursor);
  const starts = r.map((x, i) => (x.changeStart ? i : -1)).filter((i) => i >= 0);
  const target = direction > 0 ? starts.find((i) => i > at) : starts.reverse().find((i) => i < at);
  if (target !== undefined)
    set({
      cursor: { side: r[target].side, line: r[target].line },
      anchor: null,
    });
}

export function setSelection(start: Point, end: Point) {
  set({
    anchor: start.side === end.side && start.line === end.line ? null : start,
    cursor: end,
    focused: null,
  });
}

/** The commented range: one side, lines start..end. Mixed-side ranges keep the additions side. */
export function selection(s = state): { side: Side; start: number; end: number } | null {
  if (!s.cursor) return null;
  if (!s.anchor) return { side: s.cursor.side, start: s.cursor.line, end: s.cursor.line };
  const r = fileRows(s);
  const [a, b] = [rowIndex(r, s.anchor), rowIndex(r, s.cursor)].sort((x, y) => x - y);
  const picked = r.slice(a, b + 1);
  const side: Side = picked.some((x) => x.side === "additions") ? "additions" : "deletions";
  const lines = picked.filter((x) => x.side === side).map((x) => x.line);
  return { side, start: Math.min(...lines), end: Math.max(...lines) };
}

// ---------- view

export function toggleStyle() {
  const style: Style = state.style === "split" ? "unified" : "split";
  try {
    localStorage.setItem("nit.style", style);
  } catch {}
  set({ style });
}

export function toggleViewed(advance = true) {
  const file = currentFile();
  if (!file) return;
  const viewed = new Set(state.viewed);
  const now = !viewed.has(file.name);
  if (now) viewed.add(file.name);
  else viewed.delete(file.name);
  set({ viewed });
  api.setViewed(file.name, now).catch(() => toast("Couldn't save viewed state. Is nit still running?"));
  if (now && advance) {
    const i = state.files.findIndex((f, i) => i > state.current && !viewed.has(f.name));
    const wrap = i === -1 ? state.files.findIndex((f) => !viewed.has(f.name)) : i;
    if (wrap !== -1) openFile(wrap);
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** The last undoable action. ⌘Z still works after its toast has gone. */
let lastUndo: (() => void) | null = null;
export function toast(message: string, undo?: () => void) {
  clearTimeout(toastTimer);
  if (undo) lastUndo = undo;
  set({ toast: { message, undo } });
  toastTimer = setTimeout(() => set({ toast: null }), 4000);
}
export const canUndo = () => lastUndo !== null;
export function undo() {
  const fn = lastUndo;
  lastUndo = null;
  set({ toast: null });
  fn?.();
}

// ---------- drafts

/** Draft ids with changes the server hasn't confirmed yet. */
const unsaved = new Set<string>();
/** Draft ids deleted here; a reload already in flight must not bring them back. */
const deleted = new Set<string>();
const backupPrefix = () => `nit.draft.${state.data?.branch ?? ""}.`;
const backupKey = (id: string) => backupPrefix() + id;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function persist(d: Draft, delay = 300) {
  clearTimeout(timers.get(d.id));
  unsaved.add(d.id);
  try {
    localStorage.setItem(backupKey(d.id), JSON.stringify(d));
  } catch {}
  timers.set(
    d.id,
    setTimeout(async () => {
      set((s) => ({ saving: { ...s.saving, [d.id]: "saving" } }));
      try {
        await api.saveDraft(d);
        if (state.drafts.find((x) => x.id === d.id)?.updatedAt === d.updatedAt) unsaved.delete(d.id);
        try {
          localStorage.removeItem(backupKey(d.id));
        } catch {}
        set((s) => {
          const { [d.id]: _, ...saving } = s.saving;
          return { saving };
        });
      } catch {
        set((s) => ({ saving: { ...s.saving, [d.id]: "error" } }));
        persist(d, 3000); // keep retrying; the text is also in localStorage
      }
    }, delay),
  );
}

const hasContent = (d: Draft) => d.body.trim() !== "" || d.suggestion !== null;

/** A comment on the whole file rather than on lines (line 0, shown above the first change). */
export function startFileComment() {
  const file = currentFile();
  if (!file) return;
  const existing = state.drafts.find((d) => d.path === file.name && d.start === 0);
  if (existing) return set({ editing: existing.id, focused: existing.id });
  const now = Date.now();
  const draft: Draft = {
    id: crypto.randomUUID(),
    path: file.name,
    side: "additions",
    start: 0,
    end: 0,
    body: "",
    suggestion: null,
    anchor: [],
    createdAt: now,
    updatedAt: now,
  };
  set((s) => ({ drafts: [...s.drafts, draft], editing: draft.id, focused: draft.id }));
}

/** Opens the composer at once; the commented lines' text is filled in when the file contents arrive. */
export function startComment() {
  const file = currentFile();
  const sel = selection();
  if (!file || !sel) return;
  const existing = state.drafts.find(
    (d) => d.path === file.name && d.side === sel.side && d.start === sel.start && d.end === sel.end,
  );
  if (existing) return set({ editing: existing.id, focused: existing.id });
  const now = Date.now();
  const draft: Draft = {
    id: crypto.randomUUID(),
    path: file.name,
    side: sel.side,
    start: sel.start,
    end: sel.end,
    body: "",
    suggestion: null,
    anchor: [],
    createdAt: now,
    updatedAt: now,
  };
  set((s) => ({
    drafts: [...s.drafts, draft],
    editing: draft.id,
    focused: draft.id,
    anchor: null,
  }));
  fileContents(file).then(
    (text) => {
      const source = (sel.side === "additions" ? text.new : text.old) ?? "";
      const anchor = source.split("\n").slice(sel.start - 1, sel.end);
      set((s) => ({
        drafts: s.drafts.map((d) => (d.id === draft.id ? { ...d, anchor } : d)),
      }));
      const d = state.drafts.find((x) => x.id === draft.id);
      if (d && hasContent(d)) persist(d);
    },
    () => toast("Couldn't read the file. The comment is saved without its line text."),
  );
}

export function updateDraft(id: string, patch: Partial<Pick<Draft, "body" | "suggestion">>) {
  const current = state.drafts.find((d) => d.id === id);
  if (!current) return;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  set((s) => ({ drafts: s.drafts.map((d) => (d.id === id ? next : d)) }));
  if (hasContent(next)) persist(next);
}

export function finishEditing() {
  const d = state.drafts.find((x) => x.id === state.editing);
  set({ editing: null });
  if (d && !hasContent(d)) removeDraft(d.id, false);
}

export function editDraft(id: string) {
  const d = state.drafts.find((x) => x.id === id);
  if (d) set({ editing: id, focused: id });
}

export function removeDraft(id: string, offerUndo = true) {
  const d = state.drafts.find((x) => x.id === id);
  if (!d) return;
  clearTimeout(timers.get(id));
  unsaved.delete(id);
  set((s) => ({
    drafts: s.drafts.filter((x) => x.id !== id),
    focused: null,
    editing: s.editing === id ? null : s.editing,
  }));
  deleted.add(id);
  api.deleteDraft(id).then(
    () => deleted.delete(id),
    () => {},
  );
  try {
    localStorage.removeItem(backupKey(id));
  } catch {}
  if (offerUndo && hasContent(d))
    toast("Comment deleted", () => {
      deleted.delete(id);
      set((s) => ({ drafts: [...s.drafts, d], focused: d.id }));
      persist(d, 0);
    });
}

export async function suggest(id: string) {
  const d = state.drafts.find((x) => x.id === id);
  if (!d || d.side !== "additions" || d.start === 0) return;
  const file = state.files.find((f) => f.name === d.path);
  const text = d.anchor.length || !file ? null : await fileContents(file).catch(() => null);
  const lines = text ? (text.new ?? "").split("\n").slice(d.start - 1, d.end) : d.anchor;
  if (text)
    set((s) => ({
      drafts: s.drafts.map((x) => (x.id === id ? { ...x, anchor: lines } : x)),
    }));
  updateDraft(id, {
    suggestion: state.drafts.find((x) => x.id === id)?.suggestion ?? lines.join("\n"),
  });
}

export async function applySuggestion(id: string) {
  const d = state.drafts.find((x) => x.id === id);
  if (!d?.suggestion) return;
  clearTimeout(timers.get(id));
  try {
    await api.saveDraft(d);
    await api.applySuggestion(id);
    toast(`Suggestion applied to ${d.path.split("/").pop()}`);
    await load();
  } catch (e) {
    toast(e instanceof Error ? e.message : "Couldn't apply the suggestion.");
  }
}

/** Drafts in review order: by file position, then line. */
export function orderedDrafts(s = state) {
  const order = new Map(s.files.map((f, i) => [f.name, i]));
  return [...s.drafts].sort((a, b) => (order.get(a.path) ?? 1e9) - (order.get(b.path) ?? 1e9) || a.start - b.start);
}

export function jumpDraft(direction: 1 | -1) {
  const list = orderedDrafts();
  if (!list.length) return;
  const at = list.findIndex((d) => d.id === state.focused);
  const next = list[(at + direction + list.length) % list.length] ?? list[0];
  const index = state.files.findIndex((f) => f.name === next.path);
  if (index !== -1 && index !== state.current) {
    set({ current: index });
    hydrateAround(index);
  }
  set({
    focused: next.id,
    cursor: { side: next.side, line: next.end },
    anchor: null,
    editing: null,
  });
}

/** Offline backups left by a crash or a stopped server get restored on load. */
export function restoreBackups() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(backupPrefix())) continue;
      const d = JSON.parse(localStorage.getItem(key)!) as Draft;
      if (!state.drafts.some((x) => x.id === d.id)) set((s) => ({ drafts: [...s.drafts, d] }));
      persist(d, 0);
    }
  } catch {}
}
