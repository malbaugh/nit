import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { guidelinesBlock, guidelineText, loadGuidelines, quoteHolds } from "./guidelines";

let repo: string;
const ident = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function git(...args: string[]) {
  const r = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    env: { ...process.env, ...ident },
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}
const write = (p: string, s: string) => {
  mkdirSync(dirname(join(repo, p)), { recursive: true });
  writeFileSync(join(repo, p), s);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "nit-guide-"));
  git("init", "-q", "-b", "main");
  write("AGENTS.md", "# Root\nNever use JavaScript Date for arithmetic.\n");
  write("CLAUDE.md", "@AGENTS.md\n");
  write("apps/api/AGENTS.md", "# API\nEvery handler validates its input with zod.\n");
  write("apps/web/AGENTS.md", "# Web\nOnly for the web app.\n");
  write(
    ".claude/rules/billing.md",
    '---\npaths:\n  - "apps/api/billing/**"\n---\n# Billing\nAmounts are integers in cents.\n',
  );
  write(".claude/rules/web-only.md", '---\npaths:\n  - "apps/web/**"\n---\n# Web only\nx\n');
  write(".claude/rules/everywhere.md", "---\ndescription: no paths\n---\n# Everywhere\nKeep functions small.\n");
  write(".github/instructions/ts.instructions.md", '---\napplyTo: "**/*.ts"\n---\n# TS\nNo default exports.\n');
  write("apps/api/billing/charge.ts", "export const charge = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  // The branch under review rewrites a guideline; the base copy must win.
  git("checkout", "-q", "-b", "feature");
  write("apps/api/AGENTS.md", "# API\nAnything goes.\n");
  git("commit", "-qam", "loosen");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

const changed = ["apps/api/billing/charge.ts"];

test("picks the root, the nearest directory file and matching rules, from the base ref", async () => {
  const g = await loadGuidelines(repo, "main", changed);
  const paths = [...g.inline, ...g.indexed].map((d) => d.path).sort();
  expect(paths).toEqual([
    ".claude/rules/billing.md",
    ".claude/rules/everywhere.md",
    ".github/instructions/ts.instructions.md",
    "AGENTS.md",
    "apps/api/AGENTS.md",
  ]);
  expect(guidelineText(g, "apps/api/AGENTS.md")?.text).toContain("validates its input with zod");
});

test("CLAUDE.md that only imports AGENTS.md isn't repeated", async () => {
  const g = await loadGuidelines(repo, "main", changed);
  const block = guidelinesBlock(g);
  expect(block.match(/Never use JavaScript Date/g)?.length).toBe(1);
  expect(block).not.toContain('file="CLAUDE.md"');
});

test("the most specific guidance comes last in the prompt, the root first", async () => {
  const g = await loadGuidelines(repo, "main", changed);
  const order = g.inline.map((d) => d.path);
  expect(order[order.length - 1]).toBe("AGENTS.md"); // always kept: ranks highest, shown last
  expect(order.indexOf(".claude/rules/billing.md")).toBeGreaterThan(order.indexOf(".claude/rules/everywhere.md"));
});

test("a quoted rule holds only if it's in a guideline that applies to the path", async () => {
  const g = await loadGuidelines(repo, "main", changed);
  expect(quoteHolds(g, ".claude/rules/billing.md", "Amounts are integers in cents.", changed[0])).toBe(true);
  expect(quoteHolds(g, ".claude/rules/billing.md", "Amounts are floats.", changed[0])).toBe(false);
  expect(quoteHolds(g, "apps/web/AGENTS.md", "Only for the web app.", changed[0])).toBe(false);
});
