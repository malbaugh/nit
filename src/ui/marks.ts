import { useEffect } from "react";
import * as st from "./state";

/**
 * After you open a search result, the search text stays marked in whatever code you read, as in
 * an editor, until Esc. Pierre draws code in shadow roots, so the marks are Highlight API ranges
 * over its rows (styled by `::highlight(nit-find)` in DIFF_CSS) and nothing in its DOM changes.
 */

/** A Range over columns a..b of a line whose text is split across token spans. */
export function rangeIn(line: Element, a: number, b: number) {
  const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const r = new Range();
  let at = 0;
  let started = false;
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    if (!started && a < at + n.length) {
      r.setStart(n, a - at);
      started = true;
    }
    if (started && b <= at + n.length) {
      r.setEnd(n, b - at);
      return r;
    }
    at += n.length;
  }
  return null;
}

/**
 * The search as a RegExp, matching the way fff searched: smart case unless "match case" is on,
 * and a regex that doesn't compile is literal text. Leading `*.ts`, `src/` or `!x` words narrow
 * fff's files and aren't part of the text.
 */
export function matcher(s: st.State["search"]) {
  const text = s.query.replace(/^(\s*(!\S+|\S*\*\S*|\S+\/)\s+)+/, "").trim();
  if (!text) return null;
  const flags = s.caseSensitive || /[A-Z]/.test(text) ? "g" : "gi";
  const literal = () => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  if (!s.regex) return literal();
  try {
    return new RegExp(text, flags);
  } catch {
    return literal();
  }
}

function paint(re: RegExp) {
  const ranges: Range[] = [];
  for (const host of document.querySelectorAll("diffs-container"))
    for (const row of host.shadowRoot?.querySelectorAll("[data-line]") ?? []) {
      const text = row.textContent ?? "";
      for (const m of text.matchAll(re)) {
        if (!m[0]) continue; // a regex that can match nothing
        const r = rangeIn(row, m.index, m.index + m[0].length);
        if (r) ranges.push(r);
      }
    }
  CSS.highlights.set("nit-find", new Highlight(...ranges));
}

/** Keeps the marks painted while they're on: Pierre redraws rows as you scroll and switch files. */
export function useFindMarks() {
  const on = st.useStore((s) => s.marking);
  const search = st.useStore((s) => s.search);
  useEffect(() => {
    const re = on ? matcher(search) : null;
    if (!re || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const watched = new WeakSet<ShadowRoot>();
    let frame = 0;
    const repaint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint(re));
    };
    // Rows change inside each diff's shadow root (scrolling, expanding, comments opening).
    const rows = new MutationObserver(repaint);
    const attach = () => {
      let added = false;
      for (const host of document.querySelectorAll("diffs-container"))
        if (host.shadowRoot && !watched.has(host.shadowRoot)) {
          watched.add(host.shadowRoot);
          rows.observe(host.shadowRoot, { childList: true, subtree: true });
          added = true;
        }
      if (added) repaint();
    };
    // A new diff appears when the file or the view changes, and that goes through the store; the
    // rest of the page (a streaming answer, typing in a comment) never repaints the marks.
    let looking = 0;
    const off = st.subscribeToStore(() => {
      cancelAnimationFrame(looking);
      looking = requestAnimationFrame(attach);
    });
    attach();
    repaint();
    return () => {
      off();
      rows.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(looking);
      CSS.highlights.delete("nit-find");
    };
  }, [on, search]);
}
