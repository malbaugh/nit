import { expect, test } from "bun:test";
import { type Finding, hunkRanges, locateLines, proposals } from "./coreview";
import type { Guidelines } from "./guidelines";

const file = [
  "import x from 'y';",
  "",
  "export function pay(amount: number) {",
  "  return amount * 100;",
  "}",
  "",
].join("\n");
const patch = `diff --git a/src/pay.ts b/src/pay.ts
--- a/src/pay.ts
+++ b/src/pay.ts
@@ -3,3 +3,3 @@ export function pay(amount: number) {
 export function pay(amount: number) {
-  return amount;
+  return amount * 100;
 }
`;
const guidelines: Guidelines = {
  ref: "main",
  inline: [
    { path: "AGENTS.md", text: "Money is an integer number of cents.", scope: ["src/pay.ts"], rank: 1, title: "x" },
  ],
  indexed: [],
};
const ctx = {
  patch,
  guidelines,
  text: async (side: string) => (side === "additions" ? file : null),
  existing: [],
};
const finding = (over: Partial<Finding> = {}): Finding => ({
  path: "src/pay.ts",
  side: "RIGHT",
  start_line: 4,
  line: 4,
  anchor_text: "  return amount * 100;",
  label: "issue",
  blocking: true,
  severity: "important",
  verdict: "CONFIRMED",
  body: "Callers already pass cents, so this charges 100×.",
  trigger: "pay(500) charges $500 instead of $5",
  evidence: ["src/checkout.ts:12"],
  guideline: null,
  suggestion: "  return amount;",
  ...over,
});

test("hunk ranges per side", () => {
  expect(hunkRanges(patch).get("src/pay.ts")).toEqual({ old: [[3, 5]], new: [[3, 5]] });
});

test("a sound finding becomes a proposed draft with its label and evidence", async () => {
  const { drafts, dropped } = await proposals([finding()], ctx);
  expect(dropped).toEqual([]);
  expect(drafts).toHaveLength(1);
  const d = drafts[0];
  expect([d.path, d.side, d.start, d.end]).toEqual(["src/pay.ts", "additions", 4, 4]);
  expect(d.body).toBe("blocking: Callers already pass cents, so this charges 100×.");
  expect(d.anchor).toEqual(["  return amount * 100;"]);
  expect(d.proposal?.trigger).toBe("pay(500) charges $500 instead of $5");
  expect(d.suggestion).toBe("  return amount;");
});

test("a line number that's off moves to the line whose text matches", async () => {
  const { drafts } = await proposals([finding({ line: 5, start_line: 5 })], ctx);
  expect(drafts[0].end).toBe(4);
});

test("findings that don't hold are dropped, with a reason", async () => {
  const { drafts, dropped } = await proposals(
    [
      finding({ anchor_text: "return total;" }),
      finding({ line: 1, start_line: 1, anchor_text: "import x from 'y';" }),
      finding({ path: "src/other.ts" }),
      finding({ guideline: { file: "AGENTS.md", quote: "Money is a float in dollars." } }),
    ],
    ctx,
  );
  expect(drafts).toEqual([]);
  expect(dropped.map((d) => d.reason)).toEqual([
    "its line doesn't match the file",
    "outside the lines this pull request changes",
    "not a file in this diff",
    "the guideline it quotes doesn't say that, or doesn't apply here",
  ]);
});

test("a correctly quoted guideline is kept; a plausible finding becomes a question", async () => {
  const { drafts } = await proposals(
    [
      finding({
        verdict: "PLAUSIBLE",
        guideline: { file: "AGENTS.md", quote: "Money is an integer number of cents." },
      }),
    ],
    ctx,
  );
  expect(drafts[0].body.startsWith("question: ")).toBe(true);
  expect(drafts[0].proposal?.guideline?.file).toBe("AGENTS.md");
});

test("at most 5, important first, at most 2 nits", async () => {
  const many = [
    ...Array.from({ length: 4 }, () => finding({ severity: "nit", label: "nitpick", blocking: false })),
    ...Array.from({ length: 4 }, () => finding()),
  ];
  const { drafts, dropped } = await proposals(many, ctx);
  expect(drafts.map((d) => d.proposal?.severity)).toEqual(["important", "important", "important", "important", "nit"]);
  expect(dropped).toHaveLength(3);
});

test("evidence keeps path:line only; a bare file name resolves to its one repo path", async () => {
  const { drafts } = await proposals(
    [finding({ evidence: ["checkout.ts:12-14: calls pay(cents)", "src/pay.ts:4", "util.ts:3", "no location here"] })],
    { ...ctx, files: ["src/pay.ts", "src/checkout.ts", "a/util.ts", "b/util.ts"] },
  );
  expect(drafts[0].proposal?.evidence).toEqual(["src/checkout.ts:12-14", "src/pay.ts:4"]);
});

test("a conversation's lines are found where they moved, the nearest copy wins, gone is null", () => {
  const file = ["a", "x", "y", "b", "x", "y", "c"];
  expect(locateLines(file, ["x", "y"], 2)).toBe(2); // unchanged
  expect(locateLines(file, ["x", "y"], 6)).toBe(5); // nearest of two copies
  expect(locateLines(["new", ...file], ["b"], 4)).toBe(5); // moved down a line
  expect(locateLines(file, ["x  "], 2)).toBe(2); // trailing whitespace doesn't count
  expect(locateLines(file, ["gone"], 2)).toBeNull();
});
