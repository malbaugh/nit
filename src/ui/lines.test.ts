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
