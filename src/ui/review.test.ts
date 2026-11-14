import { expect, test } from "bun:test";
import type { Draft } from "../types";
import { draftsAsMarkdown } from "./review";

const d = (p: Partial<Draft>): Draft => ({
  id: "x",
  path: "a.ts",
  side: "additions",
  start: 1,
  end: 1,
  body: "",
  suggestion: null,
  anchor: [],
  createdAt: 0,
  updatedAt: 0,
  ...p,
});

test("drafts become one Markdown review, in file order, with suggestion blocks", () => {
  const md = draftsAsMarkdown(
    [
      d({ path: "b.ts", start: 4, end: 6, body: "nit: rename" }),
      d({ path: "a.ts", start: 2, end: 2, body: "why?", suggestion: "const x = 1;" }),
      d({ path: "a.ts", start: 0, end: 0, body: "whole file" }),
    ],
    ["a.ts", "b.ts"],
  );
  expect(md).toBe(
    [
      "### `a.ts`",
      "",
      "**File**",
      "",
      "whole file",
      "",
      "**Line 2**",
      "",
      "why?",
      "",
      "```suggestion",
      "const x = 1;",
      "```",
      "",
      "### `b.ts`",
      "",
      "**Lines 4–6**",
      "",
      "nit: rename",
      "",
    ].join("\n"),
  );
});
