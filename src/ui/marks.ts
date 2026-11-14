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
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const host of document.querySelectorAll("diffs-container"))
          if (host.shadowRoot && !watched.has(host.shadowRoot)) {
            watched.add(host.shadowRoot);
            rows.observe(host.shadowRoot, { childList: true, subtree: true });
          }
        paint(re);
      });
    };
    // New diff hosts appear in the page; their rows change inside their shadow roots.
    const page = new MutationObserver(schedule);
    const rows = new MutationObserver(schedule);
    page.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      page.disconnect();
      rows.disconnect();
      cancelAnimationFrame(frame);
      CSS.highlights.delete("nit-find");
    };
  }, [on, search]);
}
