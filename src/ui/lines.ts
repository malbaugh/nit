import type { FileDiffMetadata } from "@pierre/diffs";
import type { Side } from "../types";

/** A line the cursor can stop on. `changed` is false for unchanged context lines. */
export type Row = { side: Side; line: number; changeStart: boolean; changed: boolean };

/** Every line the cursor can stop on, in reading order: context and additions by new line, deletions by old line. */
export function rows(file: FileDiffMetadata): Row[] {
  const out: Row[] = [];
  for (const hunk of file.hunks) {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const part of hunk.hunkContent) {
      if (part.type === "context") {
        for (let i = 0; i < part.lines; i++)
          out.push({ side: "additions", line: newLine++, changeStart: false, changed: false });
        oldLine += part.lines;
        continue;
      }
      for (let i = 0; i < part.deletions; i++)
        out.push({ side: "deletions", line: oldLine++, changeStart: i === 0, changed: true });
      for (let i = 0; i < part.additions; i++)
        out.push({ side: "additions", line: newLine++, changeStart: i === 0 && part.deletions === 0, changed: true });
    }
  }
  return out;
}

/** Line numbers changed on each side of a file: added lines (new) and removed lines (old). */
export function changedLines(file: FileDiffMetadata) {
  const added = new Set<number>();
  const removed = new Set<number>();
  for (const r of rows(file)) if (r.changed) (r.side === "additions" ? added : removed).add(r.line);
  return { added, removed };
}

export function stats(file: FileDiffMetadata) {
  let add = 0;
  let del = 0;
  for (const h of file.hunks) {
    add += h.additionLines;
    del += h.deletionLines;
  }
  return { add, del };
}
