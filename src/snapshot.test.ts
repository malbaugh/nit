import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshots } from "./snapshot";

let dir: string;
let repo: string;
const saved = process.env.NIT_DATA_DIR;
const ident = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function git(...args: string[]) {
  const r = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    env: { ...process.env, ...ident },
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}
const write = (p: string, s: string) => writeFileSync(join(repo, p), s);
const read = (p: string) => readFileSync(join(repo, p), "utf8");

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nit-snap-"));
  repo = join(dir, "repo");
  process.env.NIT_DATA_DIR = join(dir, "data");
  Bun.spawnSync(["mkdir", "-p", repo]);
  git("init", "-q", "-b", "main");
  write("a.ts", "export const a = 1;\n");
  write("b.ts", "export const b = 2;\n");
  write("gone.ts", "export const gone = 3;\n");
  write(".gitignore", "secret.env\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env.NIT_DATA_DIR;
  else process.env.NIT_DATA_DIR = saved;
});

test("the agent's changes are the diff between snapshots; undo puts them back", async () => {
  const snaps = createSnapshots(repo, "test");
  write("b.ts", "export const b = 22;\n"); // yours, before the agent: not its change
  const before = await snaps.take();
  const realIndex = git("ls-files", "-s");

  // The agent edits one file, adds one, deletes one.
  write("a.ts", "export const a = 10;\n");
  write("new.ts", "export const fresh = true;\n");
  unlinkSync(join(repo, "gone.ts"));
  write("secret.env", "TOKEN=x\n"); // ignored: never part of a snapshot
  const after = await snaps.take();

  expect(await snaps.changed(before, after)).toEqual([
    { status: "M", path: "a.ts" },
    { status: "D", path: "gone.ts" },
    { status: "A", path: "new.ts" },
  ]);
  expect(await snaps.diff(before, after)).toContain("+export const a = 10;");
  expect(git("ls-files", "-s")).toBe(realIndex); // the real index never moves

  const r = await snaps.undo(before, after);
  expect(r).toEqual({ restored: ["a.ts", "gone.ts", "new.ts"], kept: [] });
  expect(read("a.ts")).toBe("export const a = 1;\n");
  expect(read("gone.ts")).toBe("export const gone = 3;\n");
  expect(existsSync(join(repo, "new.ts"))).toBe(false);
  expect(read("b.ts")).toBe("export const b = 22;\n"); // your earlier edit stays
  expect(read("secret.env")).toBe("TOKEN=x\n");
});

test("undo leaves a file you edited after the agent ran", async () => {
  const snaps = createSnapshots(repo, "test");
  const before = await snaps.take();
  write("a.ts", "export const a = 100;\n"); // the agent
  write("b.ts", "export const b = 200;\n"); // the agent
  const after = await snaps.take();
  write("a.ts", "export const a = 100; // reviewed\n"); // you, afterwards

  const r = await snaps.undo(before, after);
  expect(r).toEqual({ restored: ["b.ts"], kept: ["a.ts"] });
  expect(read("a.ts")).toBe("export const a = 100; // reviewed\n");
  expect(read("b.ts")).toBe("export const b = 22;\n");
});
