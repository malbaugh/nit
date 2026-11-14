/** Text and selection of a textarea. */
export type Sel = { value: string; start: number; end: number };

/** Replace value[from, to) with text, then select selStart..selEnd (offsets in the new value). */
export type Edit = { from: number; to: number; text: string; selStart: number; selEnd: number };

const lineStart = (v: string, i: number) => v.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (v: string, i: number) => {
  const n = v.indexOf("\n", i);
  return n === -1 ? v.length : n;
};

/** **bold**, _italic_, `code`: wraps the selection, or unwraps it when it's already wrapped. */
export function wrap({ value, start, end }: Sel, before: string, after = before, placeholder = "text"): Edit {
  const wrapped =
    value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after;
  if (wrapped) {
    const inner = value.slice(start, end);
    return {
      from: start - before.length,
      to: end + after.length,
      text: inner,
      selStart: start - before.length,
      selEnd: end - before.length,
    };
  }
  const inner = value.slice(start, end) || placeholder;
  return {
    from: start,
    to: end,
    text: before + inner + after,
    selStart: start + before.length,
    selEnd: start + before.length + inner.length,
  };
}

/** Inline `code`, or a fenced block when the selection spans lines. */
export function code(sel: Sel): Edit {
  const text = sel.value.slice(sel.start, sel.end);
  if (!text.includes("\n")) return wrap(sel, "`", "`", "code");
  const block = `\`\`\`\n${text}\n\`\`\``;
  return { from: sel.start, to: sel.end, text: block, selStart: sel.start + 4, selEnd: sel.start + 4 + text.length };
}

/** [selection](url) with "url" selected so it can be typed over. */
export function link({ value, start, end }: Sel, url = "url"): Edit {
  const label = value.slice(start, end) || "text";
  const text = `[${label}](${url})`;
  const urlStart = start + label.length + 3;
  return {
    from: start,
    to: end,
    text,
    selStart: value.slice(start, end) ? urlStart : start + 1,
    selEnd: value.slice(start, end) ? urlStart + url.length : start + 1 + label.length,
  };
}

/** Adds a prefix to every selected line ("> ", "- ", "1. "), or removes it when all lines have it. */
export function prefixLines({ value, start, end }: Sel, prefix: string | ((i: number) => string)): Edit {
  const from = lineStart(value, start);
  const to = lineEnd(value, end);
  const lines = value.slice(from, to).split("\n");
  const prefixFor = (i: number) => (typeof prefix === "string" ? prefix : prefix(i));
  const pattern = typeof prefix === "string" ? null : /^\d+\. /;
  const has = (l: string, i: number) => (pattern ? pattern.test(l) : l.startsWith(prefixFor(i)));
  const remove = lines.every(has);
  const next = lines.map((l, i) =>
    remove ? l.slice(pattern ? (l.match(pattern)?.[0].length ?? 0) : prefixFor(i).length) : prefixFor(i) + l,
  );
  const text = next.join("\n");
  if (start === end && lines.length === 1) {
    // A caret on one line stays where it was, shifted by the prefix.
    const caret = Math.max(from, start + text.length - (to - from));
    return { from, to, text, selStart: caret, selEnd: caret };
  }
  return { from, to, text, selStart: from, selEnd: from + text.length };
}

const LIST = /^(\s*)([-*+]|(\d+)([.)]))(\s+\[[ xX]\])?\s+(.*)$/;

/** Enter inside a list item starts the next item; Enter on an empty item ends the list. */
export function continueList({ value, start, end }: Sel): Edit | null {
  if (start !== end) return null;
  const from = lineStart(value, start);
  const line = value.slice(from, start);
  const m = line.match(LIST);
  if (!m) return null;
  const [, indent, bullet, num, delim, task, content] = m;
  if (!content.trim())
    return { from, to: start, text: indent, selStart: from + indent.length, selEnd: from + indent.length };
  const marker = num ? `${Number(num) + 1}${delim}` : bullet;
  const text = `\n${indent}${marker}${task ? " [ ]" : ""} `;
  return { from: start, to: end, text, selStart: start + text.length, selEnd: start + text.length };
}

const URL_RE = /^https?:\/\/\S+$/;

/** Pasting a URL over selected text makes it a link, as on GitHub. */
export function pasteLink(sel: Sel, pasted: string): Edit | null {
  if (sel.start === sel.end || !URL_RE.test(pasted.trim())) return null;
  const label = sel.value.slice(sel.start, sel.end);
  const text = `[${label}](${pasted.trim()})`;
  return { from: sel.start, to: sel.end, text, selStart: sel.start + text.length, selEnd: sel.start + text.length };
}

/** Flips the nth task-list checkbox in Markdown source. */
export function toggleTask(source: string, index: number): string {
  let n = -1;
  return source.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm, (all, a: string, mark: string, b: string) =>
    ++n === index ? `${a}${mark === " " ? "x" : " "}${b}` : all,
  );
}

/** Applies an edit through the browser's editing commands so ⌘Z undoes it like typing. */
export function apply(el: HTMLTextAreaElement, e: Edit) {
  el.focus();
  el.setSelectionRange(e.from, e.to);
  const ok = e.text
    ? document.execCommand("insertText", false, e.text)
    : e.from === e.to || document.execCommand("delete", false);
  if (!ok) {
    el.setRangeText(e.text, e.from, e.to, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(e.selStart, e.selEnd);
}
