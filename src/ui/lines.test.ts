import { expect, test } from "bun:test";
import type { FileDiffMetadata } from "@pierre/diffs";
import { rows } from "./lines";

test("rows walk context, deletions then additions with the right line numbers", () => {
  const file = {
    hunks: [
      {
        deletionStart: 1,
        additionStart: 1,
        hunkContent: [
          { type: "context", lines: 2 },
          { type: "change", deletions: 1, additions: 2 },
          { type: "context", lines: 1 },
        ],
      },
    ],
  } as unknown as FileDiffMetadata;
  const got = rows(file).map((r) => `${r.side[0]}${r.line}${r.changeStart ? "*" : ""}`);
  expect(got).toEqual(["a1", "a2", "d3*", "a3", "a4", "a5"]);
});

test("full rows fill the unchanged lines around hunks", () => {
  const file = {
    isPartial: false,
    additionLines: Array.from({ length: 8 }, (_, i) => `l${i + 1}`),
    hunks: [{ deletionStart: 3, additionStart: 3, hunkContent: [{ type: "change", deletions: 1, additions: 1 }] }],
  } as unknown as FileDiffMetadata;
  const got = rows(file, true).map((r) => `${r.side[0]}${r.line}`);
  expect(got).toEqual(["a1", "a2", "d3", "a3", "a4", "a5", "a6", "a7", "a8"]);
  expect(rows(file).map((r) => `${r.side[0]}${r.line}`)).toEqual(["d3", "a3"]);
});
