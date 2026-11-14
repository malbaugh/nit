import type { FileDiffMetadata } from "@pierre/diffs";
import type { Side } from "../types";

export type Row = { side: Side; line: number; changeStart: boolean };

/** Every line the cursor can stop on, in reading order: context and additions by new line, deletions by old line. */
export function rows(file: FileDiffMetadata): Row[] {
  const out: Row[] = [];
  for (const hunk of file.hunks) {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const part of hunk.hunkContent) {
      if (part.type === "context") {
        for (let i = 0; i < part.lines; i++) out.push({ side: "additions", line: newLine++, changeStart: false });
        oldLine += part.lines;
        continue;
      }
      for (let i = 0; i < part.deletions; i++) out.push({ side: "deletions", line: oldLine++, changeStart: i === 0 });
      for (let i = 0; i < part.additions; i++)
        out.push({
          side: "additions",
          line: newLine++,
          changeStart: i === 0 && part.deletions === 0,
        });
    }
  }
  return out;
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

export const statusLetter = (file: FileDiffMetadata) =>
  ({
    change: "M",
    new: "A",
    deleted: "D",
    "rename-pure": "R",
    "rename-changed": "R",
  })[file.type] ?? "M";
