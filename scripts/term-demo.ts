// Plays a short session through the terminal UI, with no server or model: `bun scripts/term-demo.ts`.
import * as term from "../src/term";
import type { AgentRun, Job } from "../src/types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
term.step("PR #2212 · feat/onshape-v2-government → main");
term.step("using the worktree at ~/Documents/crbnos/carbon-feat-onshape-v2-government");
term.banner({
  title: "feat(onshape): Onshape V2 Government panel through a customer-owned private app",
  pr: 2212,
  branch: "feat/onshape-v2-government",
  base: "origin/main",
  files: 44,
  add: 1325,
  del: 189,
  url: "http://127.0.0.1:46265",
  root: `${process.env.HOME}/Documents/crbnos/carbon-feat-onshape-v2-government`,
});
term.keys({ o: { label: "open", run: () => {} }, q: { label: "quit", run: () => process.exit(0) } });

const job: Job = {
  id: "j1",
  kind: "review",
  state: "running",
  startedAt: Date.now(),
  endedAt: null,
  error: null,
  found: 0,
  dropped: [],
  summary: null,
  at: null,
  question: null,
  answer: "",
  sessionId: null,
  guidelines: { inline: [], indexed: 0 },
} as unknown as Job;
await wait(800);
term.agent({ type: "job", job });
for (const t of ["apps/erp/app/modules/settings/onshape.server.ts", "packages/ee/src/onshape/client.ts", "AGENTS.md"]) {
  await wait(900);
  term.agent({ type: "tool", tool: "Read", target: t });
}
process.emitWarning("canUseTool will not be invoked for: Read, Glob, Grep", { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" });
await wait(700);
term.agent({
  type: "job",
  job: { ...job, state: "done", endedAt: Date.now(), found: 2, dropped: [{}] } as unknown as Job,
});
await wait(600);
term.error(new Error("ENOENT: no such file, open 'apps/x.ts'"));
await wait(600);
const run = { id: "r1", state: "running", drafts: ["a", "b", "c"], startedAt: Date.now(), endedAt: null, outcomes: [], files: [], error: null } as unknown as AgentRun;
term.agent({ type: "run", run });
await wait(1500);
term.agent({ type: "tool", tool: "Edit", target: "packages/ee/src/onshape/client.ts" });
await wait(1200);
term.agent({
  type: "run",
  run: { ...run, state: "done", endedAt: Date.now(), outcomes: [{ status: "done" }, { status: "done" }, { status: "skipped" }], files: ["a", "b"] } as unknown as AgentRun,
});
term.log(`${term.c.green("✓")} posted to GitHub: 3 comments`);
